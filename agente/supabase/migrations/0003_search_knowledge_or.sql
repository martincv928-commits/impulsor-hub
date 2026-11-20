-- La búsqueda exigía TODAS las palabras (AND) y fallaba con preguntas largas. Ahora basta con alguna (OR), ordenado por relevancia.
create or replace function search_knowledge(p_tenant uuid, p_query text, p_limit int default 5)
returns table (source_id uuid, content text, rank real) language plpgsql stable security definer set search_path = public as $$
declare q tsquery; lex text[];
begin
  lex := tsvector_to_array(to_tsvector('spanish', coalesce(p_query, '')));
  if lex is null or cardinality(lex) = 0 then return; end if;
  -- los lexemas ya vienen en raíz (spanish); se consultan con 'simple' y entrecomillados para no romper la sintaxis
  q := to_tsquery('simple', (select string_agg(format('%L', l), ' | ') from unnest(lex) l));
  return query
    select c.source_id, c.content, ts_rank(c.tsv, q) as rank
    from knowledge_chunks c where c.tenant_id = p_tenant and c.tsv @@ q
    order by rank desc limit least(greatest(p_limit, 1), 10);
end $$;
revoke all on function search_knowledge(uuid, text, int) from public, anon, authenticated;
grant execute on function search_knowledge(uuid, text, int) to service_role;
