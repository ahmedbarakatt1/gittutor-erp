-- Keep the applied read migration; disambiguate the local normalized contact from verified_contacts.destination.
create or replace function api.lookup_transfer_payer(p_transfer_id uuid,p_contact_channel text,p_exact_contact text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=app_private.require_actor();items jsonb;normalized_contact text;begin
 perform app_private.payment_current_staff(actor);if not exists(select 1 from finance_private.incoming_transfers where id=p_transfer_id) then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if p_exact_contact is null or length(p_exact_contact) not between 1 and 320 or p_exact_contact<>btrim(p_exact_contact) then raise exception 'VALIDATION_ERROR';end if;
 if p_contact_channel='email' then if p_exact_contact!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_ERROR';end if;normalized_contact:=lower(p_exact_contact);
 elsif p_contact_channel='phone' then if p_exact_contact!~'^\+[1-9][0-9]{6,14}$' then raise exception 'VALIDATION_ERROR';end if;normalized_contact:=p_exact_contact;else raise exception 'VALIDATION_ERROR';end if;
 select coalesce(jsonb_agg(app_private.payment_payer_dto(x.account_id) order by x.account_id),'[]') into items from(select distinct c.account_id from app_private.verified_contacts c where c.channel=p_contact_channel and c.destination=normalized_contact and c.verified_at is not null and c.revoked_at is null and app_private.payment_verified_account(c.account_id) order by c.account_id limit 10)x;
 return jsonb_build_object('items',items);
end $$;
