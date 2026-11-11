-- SELECT FOR UPDATE needs a column UPDATE privilege; mutex remains private.
grant update(learner_id) on app_private.learner_financial_mutex to git_tutor_commands;
