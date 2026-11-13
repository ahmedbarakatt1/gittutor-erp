-- Row locks require UPDATE privilege on a column. The immutable-row trigger still
-- rejects every actual UPDATE; this permits dispatch/revocation serialization only.
grant update(id) on app_private.whatsapp_templates to git_tutor_commands;
