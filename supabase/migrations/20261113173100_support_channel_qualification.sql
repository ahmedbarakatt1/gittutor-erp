create or replace function app_private.support_command(p_name text,p_input jsonb,p_key text)returns jsonb language plpgsql security definer set search_path='' as $$declare actor uuid:=app_private.require_actor(true);c app_private.conversations%rowtype;channel app_private.whatsapp_channels%rowtype;t app_private.whatsapp_templates%rowtype;ctx jsonb;mid uuid;result jsonb;begin
 if p_name in('submit_message','request_handoff')and not app_private.support_read_scope(actor,(p_input->>'conversation_id')::uuid)then raise exception'FORBIDDEN';end if;
 if p_name<>'reply_to_conversation'or not exists(select 1 from app_private.conversations candidate where candidate.id=(p_input->>'conversation_id')::uuid and candidate.channel='whatsapp')then result:=app_private.support_website_command(p_name,p_input,p_key);if p_name in('transfer_conversation','escalate_conversation')then perform app_private.enqueue_event(md5('support:'||(result->>'command_id'))::uuid,case when p_name='transfer_conversation'then'support_transferred'else'support_escalated'end,(result->>'conversation_id')::uuid,jsonb_build_object('conversation_id',result->>'conversation_id','version',result->'version'),'notifications.route');end if;return result;end if;
 perform app_private.require_actor();select * into c from app_private.conversations where id=(p_input->>'conversation_id')::uuid for update;if not app_private.support_staff(actor)or c.owner_account_id is distinct from actor then raise exception'OWNER_REQUIRED';end if;
 ctx:=app_private.booking_begin(actor,p_name,p_input,p_key);if ctx->'replay_result'<>'null'::jsonb then return ctx->'replay_result';end if;
 if c.version is distinct from(p_input->>'expected_version')::integer then raise exception'VERSION_CONFLICT';end if;if c.state<>'assigned'then raise exception'STATE_CONFLICT';end if;
 select * into channel from app_private.whatsapp_channels where conversation_id=c.id for update;if channel.consent='opted_out'then raise exception'CONSENT_REQUIRED';end if;
 if(p_input->>'text'is null)=(p_input->>'template_id'is null)then raise exception'VALIDATION_ERROR';end if;
 if p_input->>'template_id'is null then
  if c.last_whatsapp_user_message_at is null or c.last_whatsapp_user_message_at<=now()-interval'24 hours'then raise exception'WINDOW_CLOSED';end if;
  if length(btrim(p_input->>'text'))not between 1 and 4000 or p_input->'template_parameters'<>'[]'::jsonb then raise exception'VALIDATION_ERROR';end if;
 else
  select * into t from app_private.whatsapp_templates where id=(p_input->>'template_id')::uuid;
  if t.id is null or not t.approved or t.provider_mode<>channel.provider_mode then raise exception'TEMPLATE_REQUIRED';end if;
  if channel.consent<>'opted_in'then raise exception'CONSENT_REQUIRED';end if;
  if jsonb_typeof(p_input->'template_parameters')is distinct from'array'or jsonb_array_length(p_input->'template_parameters')<>t.parameter_count or exists(select 1 from jsonb_array_elements(p_input->'template_parameters')v where jsonb_typeof(v)<>'string'or length(v#>>'{}')not between 1 and 500)then raise exception'VALIDATION_ERROR';end if;
 end if;
 mid:=app_private.support_queue_whatsapp(c.id,actor,'staff',coalesce(btrim(p_input->>'text'),'Approved template: '||t.name),(p_input->>'template_id')::uuid,p_input->'template_parameters');update app_private.conversations set version=version+1,waiting_since=null,updated_at=now()where id=c.id returning * into c;
 return app_private.booking_finish(ctx,c.id,c.version,jsonb_build_object('conversation_id',c.id,'state',c.state,'owner_id',c.owner_account_id),'support_reply_queued',jsonb_build_object('conversation_id',c.id,'message_id',mid));end$$;
