-- Amplía los valores permitidos para canales de WhatsApp. Separada de 0002 porque borra y recrea restricciones
-- (Supabase pide confirmación explícita). Necesaria sólo para activar WhatsApp.
alter table channels drop constraint channels_kind_check;
alter table channels add constraint channels_kind_check check (kind in ('web','whatsapp'));
alter table conversations drop constraint conversations_channel_check;
alter table conversations add constraint conversations_channel_check check (channel in ('app','web','whatsapp'));
