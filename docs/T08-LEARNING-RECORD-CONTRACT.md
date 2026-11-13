# T08 published learning records (GT-803)

Supplement to the delivery contract and acceptance GT-803. Internal completion/attendance notes are not customer learning content. Publication is a separate, explicit action by the currently assigned tutor or an administrator, after approved completion.

`POST /api/v1/learning-records/{occurrence_id}` calls `publish_learning_record(occurrence_id,learner_id,content,expected_version,idempotency_key)`. A null learner identifies the shared class summary. A named confirmed learner identifies private feedback. The version is the learning-record version (zero before first publication). Every successful publication appends an immutable revision; prior content is retained. Corrections append another explicit publication. Current role/assignment is checked before idempotent replay. No financial or completion record is changed.

`GET /api/v1/learning-records/{occurrence_id}?view=customer&learner_id=...` requires the current student's identity or an active guardian relationship with `materials` scope and a confirmed enrollment. It returns the latest shared summary plus only that learner's latest feedback, with strict field allowlists. It never returns the roster, other learners' feedback, author account identifiers, internal completion notes, attendance reasons, fees or margins. Tutor/admin views recheck current assignment/role, provide the current confirmed roster for audience selection, and expose revision history only within that privileged scope.

Customer booking details show the published content for completed occurrences. The tutor/admin delivery panel has separate “Publish shared class summary” and “Publish private learner feedback” forms with explicit audience confirmation and no prefilled internal notes.

`learning_record_published` has aggregate record ID and payload `{record_id,revision_id,occurrence_id,learner_id}`. Null learner means the authorized current class roster; otherwise only the named learner/current guardians may receive a secure portal pointer. Message bodies must not copy the learning content or peer identifiers. Notification routing is owned by T09.
