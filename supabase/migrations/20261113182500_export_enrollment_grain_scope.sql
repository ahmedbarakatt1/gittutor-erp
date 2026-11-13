create or replace function app_private.export_assert_scope(p_actor uuid,p_session uuid,p_kind text,p_filters jsonb,p_columns text[])returns void language plpgsql security definer set search_path='' as $$declare learner uuid;begin
 if not app_private.auth_session_active(p_actor,p_session)or not app_private.payment_verified_account(p_actor)then raise exception 'SESSION_REVOKED';end if;
 if p_kind like 'admin_%'then perform app_private.require_role(p_actor,'admin');
 elsif p_kind='own_tutor_statement'then perform app_private.require_role(p_actor,'tutor');if not exists(select 1 from app_private.tutors where account_id=p_actor)then raise exception 'NOT_FOUND';end if;
 elsif p_kind='own_account'then
 for learner in select value::uuid from jsonb_array_elements_text(p_filters->'learner_ids')loop
 -- Every row and date filter has enrollment grain, even when only profile columns are selected.
 perform app_private.assert_learner_scope(p_actor,learner,'booking',false);
 if p_columns&&array['learner_id','display_name']then perform app_private.assert_learner_scope(p_actor,learner,'profile',false);end if;

 if p_columns&&array['customer_charge_minor','allocated_cash_minor','balance_minor','currency']then perform app_private.assert_learner_scope(p_actor,learner,'payments',false);end if;
 end loop;
 else raise exception 'VALIDATION_ERROR';end if;end$$;
notify pgrst,'reload schema';

