import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WhatsAppClient, parseWebhook, phonesMatch, splitMessage, timingSafeEqual, verifyAccess, verifySignature } from '../supabase/functions/_shared/whatsapp.ts';
import { WIDGET_JS } from '../supabase/functions/_shared/widget.ts';

const sign = (body: string, secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('whatsapp: firma del webhook', () => {
  const body = '{"object":"whatsapp_business_account"}';
  it('acepta firma válida y rechaza inválida, ausente o con otro secreto', async () => {
    expect(await verifySignature(body, sign(body, 's3cret'), 's3cret')).toBe(true);
    expect(await verifySignature(body, sign(body, 'otro'), 's3cret')).toBe(false);
    expect(await verifySignature(body + ' ', sign(body, 's3cret'), 's3cret')).toBe(false);
    expect(await verifySignature(body, null, 's3cret')).toBe(false);
    expect(await verifySignature(body, 'sha256=abc', 's3cret')).toBe(false);
    expect(await verifySignature(body, sign(body, ''), '')).toBe(false); // sin secreto configurado nunca valida
    expect(await verifySignature(body, 'md5=' + 'a'.repeat(64), 's3cret')).toBe(false);
  });
});

describe('whatsapp: lectura de webhooks', () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567' }, messages: [
    { id: 'wamid.1', from: '5215512345678', type: 'text', text: { body: 'ventas del mes' } },
    { id: 'wamid.2', from: '5215512345678', type: 'audio', audio: { id: 'x' } },
    { id: 7, from: 'x', type: 'text' }] } }, { value: { metadata: { phone_number_id: '1234567' }, statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] };
  it('extrae mensajes de texto y marca otros tipos sin texto; ignora estados y basura', () => {
    expect(parseWebhook(payload)).toEqual([
      { wamid: 'wamid.1', from: '5215512345678', phoneNumberId: '1234567', type: 'text', text: 'ventas del mes' },
      { wamid: 'wamid.2', from: '5215512345678', phoneNumberId: '1234567', type: 'audio', text: '' }]);
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]); expect(parseWebhook(null)).toEqual([]); expect(parseWebhook({})).toEqual([]);
  });
});

describe('whatsapp: números', () => {
  it('coincide con o sin el 1 de México y rechaza distintos', () => {
    expect(phonesMatch('5215512345678', '525512345678')).toBe(true);
    expect(phonesMatch('+52 1 55 1234 5678', '5215512345678')).toBe(true);
    expect(phonesMatch('5215512345678', '5215512345679')).toBe(false);
    expect(phonesMatch('', '5215512345678')).toBe(false); expect(phonesMatch('12345678', '87654321')).toBe(false);
  });
  it('REGRESIÓN: otro país con los mismos últimos 10 dígitos NO coincide', () => {
    expect(phonesMatch('5215512345678', '15512345678')).toBe(false); // EE. UU. +1 551 234 5678
    expect(phonesMatch('525512345678', '445512345678')).toBe(false);
    expect(phonesMatch('5512345678', '525512345678')).toBe(false); // sin código de país no se adivina
  });
  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true); expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false); expect(timingSafeEqual('', '')).toBe(true);
  });
  it('splitMessage respeta el límite y no pierde texto', () => {
    const t = Array.from({ length: 900 }, (_, i) => 'palabra' + i).join(' ');
    const parts = splitMessage(t, 1000);
    expect(parts.length).toBeGreaterThan(5); for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000);
    expect(parts.join(' ').split(' ').length).toBe(900); expect(splitMessage('hola')).toEqual(['hola']); expect(splitMessage('  ')).toEqual([]);
  });
});

describe('whatsapp: cliente de envío (fetch simulado)', () => {
  it('sendText y sendDocument llaman a Graph con token, destino y archivo correctos', async () => {
    const calls: { url: string; init: any }[] = [];
    const f = (async (url: string, init: any) => { calls.push({ url, init }); return Response.json(url.endsWith('/media') ? { id: 'MEDIA1' } : { messages: [{ id: 'ok' }] }); }) as unknown as typeof fetch;
    const wa = new WhatsAppClient('TOKEN', '999', 'v99.0', f);
    await wa.sendText('5215512345678', 'hola');
    await wa.sendDocument('5215512345678', { filename: 'r.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-x').toString('base64') });
    expect(calls.map((c) => c.url)).toEqual(['https://graph.facebook.com/v99.0/999/messages', 'https://graph.facebook.com/v99.0/999/media', 'https://graph.facebook.com/v99.0/999/messages']);
    expect(calls[0].init.headers.authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(calls[0].init.body)).toEqual({ messaging_product: 'whatsapp', to: '5215512345678', type: 'text', text: { body: 'hola' } });
    expect(calls[1].init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(calls[2].init.body)).toMatchObject({ type: 'document', document: { id: 'MEDIA1', filename: 'r.pdf' } });
  });
  it('error de Graph se propaga', async () => {
    const f = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(new WhatsAppClient('T', '1', 'v1', f).sendText('1', 'x')).rejects.toThrow(/401/);
  });
});

describe('whatsapp: prueba de propiedad del número (verifyAccess)', () => {
  const mk = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
  it('acepta sólo si Graph confirma el mismo id con ese token', async () => {
    expect(await verifyAccess('T', '123456', 'v1', mk(200, { id: '123456' }))).toBe(true);
    expect(await verifyAccess('T', '123456', 'v1', mk(200, { id: '999999' }))).toBe(false);
    expect(await verifyAccess('T', '123456', 'v1', mk(401, { error: {} }))).toBe(false);
    expect(await verifyAccess('T', '123456', 'v1', (async () => { throw new Error('red'); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe('widget servido por la función', () => {
  it('REGRESIÓN: no manda cabeceras de autorización vacías cuando no hay clave', () => {
    expect(WIDGET_JS).toContain("if (key) { h.apikey = key; h.authorization = 'Bearer ' + key; }");
    expect(WIDGET_JS).not.toMatch(/authorization: 'Bearer ' \+ key \}/);
  });
  it('es JavaScript válido, deduce la API de su propia URL y no incluye claves', () => {
    expect(() => new Function(WIDGET_JS)).not.toThrow();
    expect(WIDGET_JS).toContain("s.src.replace(/\\/widget\\.js.*$/, '')");
    expect(WIDGET_JS).not.toMatch(/sb_publishable|service_role|eyJ/);
  });
});
