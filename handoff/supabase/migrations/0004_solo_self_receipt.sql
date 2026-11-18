-- 0004: equipo de una sola persona — puede recibir su propia entrega (queda marcada como «recepción propia»).
create or replace function receive_handoff(p_id uuid, p_decision text, p_notes text default null, p_ack jsonb default '{}')
returns handoff_receipts language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); h handoffs; r handoff_receipts; v_role text; v_event text; v_hook text; v_self boolean := false; v_ack jsonb := coalesce(p_ack, '{}'::jsonb);
begin
  if p_decision not in ('accepted','accepted_with_observations','discrepancy','rejected') then
    raise exception 'invalid_decision';
  end if;
  select * into h from handoffs where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_role := member_role(h.org_id, u);
  if v_role is null then raise exception 'not_found'; end if;     -- no revelar existencia a otras empresas
  if h.status = 'draft' then raise exception 'not_submitted'; end if;
  select * into r from handoff_receipts where handoff_id = p_id;
  if found then return r; end if;                                  -- idempotente: doble clic / reintento
  if u = h.from_user then
    -- Un equipo de UNA sola persona no tendría quién reciba: se permite recibir la propia entrega,
    -- marcada como «recepción propia». Con 2 o más personas activas rige la separación normal.
    if (select count(*) from organization_members where org_id = h.org_id and active) > 1 then
      raise exception 'forbidden_self' using errcode = '42501';
    end if;
    v_self := true;
    v_ack := v_ack || jsonb_build_object('self_receipt', true);
  end if;
  if h.to_user is not null and u <> h.to_user and v_role not in ('admin','supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision <> 'accepted' and length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'justification_required';
  end if;

  insert into handoff_receipts (org_id, handoff_id, received_by, decision, notes, acknowledged)
  values (h.org_id, h.id, u, p_decision, nullif(btrim(coalesce(p_notes, '')), ''), v_ack)
  returning * into r;
  update handoffs set status = case p_decision when 'accepted' then 'accepted'
      when 'accepted_with_observations' then 'accepted_obs' when 'discrepancy' then 'disputed' else 'rejected' end
  where id = h.id;

  -- RECIBIR información ≠ ACEPTAR responsabilidad: sólo se registra "received"; el responsable no cambia.
  if p_decision <> 'rejected' then
    insert into issue_events (org_id, issue_id, actor, action, data)
    select h.org_id, (i->>'id')::uuid, u, 'received', jsonb_build_object('handoff_id', h.id, 'decision', p_decision)
    from jsonb_array_elements(coalesce(h.snapshot->'issues_created', '[]'::jsonb) || coalesce(h.snapshot->'issues_open', '[]'::jsonb)) i;
  end if;

  v_event := case p_decision when 'rejected' then 'handoff_rejected' when 'discrepancy' then 'handoff_discrepancy' else 'handoff_accepted' end;
  v_hook  := case p_decision when 'rejected' then 'handoff.rejected' when 'discrepancy' then 'handoff.disputed' else 'handoff.accepted' end;
  perform _notify(h.org_id, h.site_id, h.area_id, v_event,
                  case p_decision when 'rejected' then 'Entrega RECHAZADA' when 'discrepancy' then 'Entrega con DISCREPANCIA'
                       when 'accepted_with_observations' then 'Entrega aceptada con observaciones' else 'Entrega aceptada' end,
                  p_notes, 'handoffs', h.id, array[h.from_user]);
  perform _audit(h.org_id, u, 'handoff.' || p_decision, 'handoffs', h.id, jsonb_build_object('notes', p_notes, 'self_receipt', v_self));
  perform _enqueue(h.org_id, v_hook, v_hook || ':' || h.id,
    jsonb_build_object('handoff_id', h.id, 'decision', p_decision, 'received_by', u, 'received_at', r.received_at, 'notes', p_notes));
  return r;
end $$;
