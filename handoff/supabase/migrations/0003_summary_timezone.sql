-- 0003: las fechas del resumen del supervisor usan la hora de México (antes UTC: una entrega de las 7 p.m. caía al día siguiente).
create function mx_today() returns date language sql stable as $$ select (now() at time zone 'America/Mexico_City')::date $$;
revoke all on function mx_today() from public, anon, authenticated;
grant execute on function mx_today() to authenticated, service_role;

create or replace function supervisor_summary(p_org uuid, p_from date default (current_date - 7), p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'generated_at', clock_timestamp(), 'from', p_from, 'to', p_to,
    'handoffs', jsonb_build_object(
      'pending_receipt', (select count(*) from handoffs where org_id = p_org and status = 'pending_receipt'),
      'accepted', (select count(*) from handoffs where org_id = p_org and status = 'accepted' and shift_date between p_from and p_to),
      'accepted_obs', (select count(*) from handoffs where org_id = p_org and status = 'accepted_obs' and shift_date between p_from and p_to),
      'disputed', (select count(*) from handoffs where org_id = p_org and status = 'disputed' and shift_date between p_from and p_to),
      'rejected', (select count(*) from handoffs where org_id = p_org and status = 'rejected' and shift_date between p_from and p_to)),
    'issues', jsonb_build_object(
      'open', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked')),
      'critical', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and priority = 'critical'),
      'overdue', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and due_date < mx_today()),
      'unassigned', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and assignee is null),
      'blocked', (select count(*) from issues where org_id = p_org and status = 'blocked'),
      'created_in_range', (select count(*) from issues where org_id = p_org and (created_at at time zone 'America/Mexico_City')::date between p_from and p_to),
      'resolved_in_range', (select count(*) from issues where org_id = p_org and status = 'resolved' and (resolved_at at time zone 'America/Mexico_City')::date between p_from and p_to)),
    'pending_list', (select coalesce(jsonb_agg(x order by x->>'submitted_at'), '[]'::jsonb) from (
        select jsonb_build_object('id', h.id, 'area', a.name, 'site', s.name, 'shift', d.name, 'shift_date', h.shift_date,
               'from_name', m.display_name, 'submitted_at', h.submitted_at,
               'age_minutes', floor(extract(epoch from (clock_timestamp() - h.submitted_at)) / 60)) x
        from handoffs h join areas a on a.id = h.area_id join sites s on s.id = h.site_id
        join shift_definitions d on d.id = h.shift_id
        join organization_members m on m.org_id = h.org_id and m.user_id = h.from_user
        where h.org_id = p_org and h.status = 'pending_receipt' limit 20) q),
    'disputed_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', h.id, 'area', a.name, 'shift_date', h.shift_date, 'status', h.status, 'notes', r.notes) x
        from handoffs h join areas a on a.id = h.area_id join handoff_receipts r on r.handoff_id = h.id
        where h.org_id = p_org and h.status in ('disputed','rejected') and h.shift_date between p_from and p_to
        order by r.received_at desc limit 20) q),
    'critical_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select _issue_json(i) x from issues i where i.org_id = p_org and i.status in ('open','in_progress','blocked')
          and (i.priority = 'critical' or i.due_date < mx_today() or i.assignee is null)
        order by (i.priority = 'critical') desc, i.created_at limit 20) q),
    'resolved_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', i.id, 'title', i.title, 'resolved_at', i.resolved_at,
               'resolved_by', (select display_name from organization_members where org_id = i.org_id and user_id = i.resolved_by)) x
        from issues i where i.org_id = p_org and i.status = 'resolved' and (i.resolved_at at time zone 'America/Mexico_City')::date between p_from and p_to
        order by i.resolved_at desc limit 10) q),
    'recent_activity', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('action', e.action, 'entity_type', e.entity_type, 'entity_id', e.entity_id,
               'at', e.created_at, 'actor', (select display_name from organization_members where org_id = e.org_id and user_id = e.actor)) x
        from audit_events e where e.org_id = p_org and e.entity_type in ('handoffs','issues')
        order by e.created_at desc limit 10) q)
  );
end $$;
