-- 0020: The payment ledger stays append-only, but deleting an account must still work: the FK on
-- payment_events.actor_id is ON DELETE SET NULL, which is an UPDATE. Allow exactly that (cascade-driven,
-- actor_id → null, nothing else changed); every other update or delete is still rejected.
create or replace function public.tg_ledger_immutable()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if new.actor_id is null and old.actor_id is not null
       and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
      return new;
    end if;
  end if;
  raise exception 'The payment ledger is append-only' using errcode = '42501';
end $$;
