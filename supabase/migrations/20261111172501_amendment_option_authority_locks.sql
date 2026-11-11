-- Current session/role/scope checks take authority locks, even though the selector changes no domain data.
alter function api.list_charge_amendment_funding_options(uuid,text,integer) volatile;
notify pgrst,'reload schema';
