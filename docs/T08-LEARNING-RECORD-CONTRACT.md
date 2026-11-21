# T08 published learning records (GT-803)

Supplement to the delivery contract and acceptance GT-803. Internal completion/attendance notes are not customer learning content. Publication is a separate, explicit action by the currently assigned tutor or an administrator, after approved completion.

`POST /api/v1/learning-records/{occurrence_id}` calls `publish_learning_record(occurrence_id,learner_id,content,expected_version,idempotency_key)`. A null learner identifies the shared class summary. A named confirmed learner identifies private feedback. The version is the learning-record version (zero before first publication). Every successful publication appends an immutable revision; prior content is retained. Corrections append another explicit publication. Current role/assignment is checked before idempotent replay. No financial or completion record is changed.

`GET /api/v1/learning-records/{occurrence_id}?view=customer&learner_id=...` requires the current student's identity or an active guardian relationship with `materials` scope and a confirmed enrollment. It returns the latest shared summary plus only that learner's latest feedback, with strict field allowlists. It never returns the roster, other learners' feedback, author account identifiers, internal completion notes, attendance reasons, fees or margins. Tutor/admin views recheck current assignment/role, provide the current confirmed roster for audience selection, and expose revision history only within that privileged scope.

Customer booking details show the published content for completed occurrences. The tutor/admin delivery panel has separate “Publish shared class summary” and “Publish private learner feedback” forms with explicit audience confirmation and no prefilled internal notes.

`learning_record_published` has aggregate record ID and payload `{record_id,revision_id,occurrence_id,learner_id}`. Null learner means the authorized current class roster; otherwise only the named learner/current guardians may receive a secure portal pointer. Message bodies must not copy the learning content or peer identifiers. Notification routing is owned by T09.

## Session quizzes and private grades

From **Tutor → Quizzes**, select a session, open **Add a PDF quiz**, and upload a PDF or choose a checked PDF already attached to that session. The 25 MiB teaching-file limit applies. Enter a title and maximum points, then choose **Publish quiz**. This publishes the checked handout to confirmed learners. An upload awaiting its scan cannot be assigned. On a quiz, select one confirmed learner, enter points earned and publish their grade. To correct it, select that learner again and update their grade. Scores and maximum points allow two decimal places. The maximum must be positive and at most 10,000.

**Learning → Quizzes and grades** lists assigned quizzes across sessions. Each row identifies the learner and session, shows the PDF download when currently permitted, and displays the recorded score or “Awaiting grade.” Zero is a published grade. A guardian needs a current materials relationship with the named learner. Withdrawing a PDF removes its download while retaining the learner's grade. The session file and each learner's grade have separate access checks.

| Endpoint | Caller and behavior |
| --- | --- |
| `POST /api/v1/occurrences/{id}/quizzes` | Current assigned tutor submits `title`, `file_id` and `max_score`. The database checks the actual finalized clean PDF and its session, and publishes the file and assignment in one transaction. |
| `POST /api/v1/quizzes/{id}/grades` | Current assigned tutor submits `learner_id`, `score` and `expected_version` (zero for first publication). Corrections append a revision. Both writes accept an idempotency key. |
| `GET /api/v1/occurrences/{id}/quizzes` | The tutor view includes the confirmed roster. The customer view requires a learner ID and returns only that learner's results. |
| `GET /api/v1/me/quiz-results` | Lists currently authorized quiz results across sessions with cursor pagination and an optional learner filter. Download links use the authenticated private file endpoint. |

See the [typed query and command contracts](../src/modules/teaching/quizzes.ts), [database regression](../tests/integration/quizzes.test.ts) and [browser walkthrough](../tests/e2e/quizzes.spec.ts).
