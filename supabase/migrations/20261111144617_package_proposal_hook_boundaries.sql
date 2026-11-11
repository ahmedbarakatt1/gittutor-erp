create or replace function app_private.package_expire_proposals(p_purchase_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare p app_private.operation_proposals%rowtype;ids uuid[]:='{}';event_id uuid;begin
 for p in select header.* from app_private.operation_proposals header join app_private.package_operation_terms t on t.proposal_id=header.id where t.source_purchase_id=p_purchase_id and header.state in('proposed','accepted','approved') and header.expires_at<=now() order by header.id for update of header loop
  update app_private.operation_proposals set state='expired',version=version+1,invalidated_reason='window_closed',updated_at=now() where id=p.id;ids:=array_append(ids,p.id);event_id:=gen_random_uuid();
  insert into app_private.audit_events(actor_account_id,command_id,action,aggregate_id,details) values(null,event_id,'package_proposal_expired',p.id,jsonb_build_object('actor_kind','system','package_purchase_id',p_purchase_id));
  perform app_private.enqueue_event(event_id,'package_proposal_expired',p.id,jsonb_build_object('proposal_id',p.id,'package_purchase_id',p_purchase_id),'notifications.route');
 end loop;return ids;
end $$;
create or replace function app_private.booking_pending_proposals(p_occurrence_id uuid,p_learner_id uuid default null,p_tutor_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('proposal_id',p.id,'kind',case when p.kind='group_amendment' then 'amendment' else 'operation' end) order by p.created_at,p.id),'[]') from app_private.operation_proposals p
 where p.occurrence_id=p_occurrence_id and p.state in('proposed','accepted','approved') and p.expires_at>now()
 and(p_learner_id is null or exists(select 1 from app_private.operation_customer_terms where proposal_id=p.id and learner_id=p_learner_id) or exists(select 1 from app_private.package_operation_terms t where t.proposal_id=p.id and t.learner_id=p_learner_id and app_private.package_proposal_can_access(app_private.require_actor(),t.learner_id,p.kind)))
 and(p_tutor_id is null or exists(select 1 from finance_private.operation_tutor_terms where proposal_id=p.id and tutor_id=p_tutor_id))
$$;
notify pgrst,'reload schema';
