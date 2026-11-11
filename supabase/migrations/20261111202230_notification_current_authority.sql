-- Current-session authorization acquires share locks and must run in a write-capable RPC transaction.
alter function api.list_my_notifications(integer,uuid) volatile;
alter function api.get_notification_preferences() volatile;
alter function api.list_notification_deliveries(integer,uuid,text) volatile;
alter function api.list_notification_queues() volatile;
