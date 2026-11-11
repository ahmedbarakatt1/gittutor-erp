# Runtime catalog schemas

`catalog-schemas.json` is the shared structural boundary for editable commercial JSON. It maps revision `2026-11-11.1` of `contracts/policy-settings.json` and `contracts/pricing-policy.json` into three standalone Draft 7 schemas. It contains no private compensation amounts or development fixtures.

| Schema | Command input | Mapping |
|---|---|---|
| `policy_content` | `content` in policy create/update | Runtime commercial fields, excluding policy ID, status, environment, synthetic provenance, approval actor/time and effective time |
| `customer_pricing` | `customer_pricing` | Currency, pricing unit, duration, group tiers and private seat price |
| `compensation` | `compensation` | Currency, group fee bands and private exact-approval fee rule; admin commands only |

Every object rejects unknown properties, including nested package contracts, cancellation windows and tier rows. Draft properties may be omitted or null. A supplied non-null value must satisfy its declared type, range and vocabulary. Approval additionally requires every applicable common, group/private and package setting through explicit semantic validators. Zero and false count as supplied values.

The schemas use the tested subset of pinned Zod 4.6.7 `fromJSONSchema`: explicit types/items, strict properties, bounded safe integers, enum/const, nullable `anyOf`, array uniqueness and ordinary bounds. They avoid defaults/coercion, conditionals, dependencies, external references, and validation siblings beside enum or `$ref`. Array schemas always declare `items`. These restrictions avoid unsupported or silently weaker conversions. The database validates the same immutable schema snapshot with `pg_jsonschema`; shared vectors exercise the two semantic implementations.

`kind` is `booking`; commercial `scope` is `group` or `private`. Environment and synthetic provenance come from persisted deployment metadata. The policy's customer and compensation references identify the same approved pricing-version UUID. The nested package policy ID is its owning policy UUID: commands derive missing/null values and reject another supplied identity. Draft offer creation permits draft references so an offer ID can be included in a package's eligibility list before approval; publication requires complete approved compatible records.

Canonical synthetic pricing preserves the supplied group amounts and fee bands. An explicitly approved new immutable pricing version may change amounts. Publication never rewrites an existing version or an accepted quote. Source baseline lineage is separate from editable pricing content.

Package approval binds named-entitlement coverage to unit-based funding and value/top-up coverage to its distinct funding source. Disabled packages cannot enable package funding or restoration remedies. Expiry, eligibility, integer quanta and refund/rounding rules must be explicit. T05–T06 transactions enforce quantity/value conservation, compatible acyclic transfers, settled funding and shared refund/restoration limits; structural validation does not attest to those balances.

Customer pricing and policy projections construct fixed allowlists. Runtime modules do not import the internal authoring manifests. T03's projection checks do not certify later receipt, email, export or downloadable-file implementations: full GT-1205/GT-1211/GT-1212 execution remains dependent on their owning downstream milestones.

References: [Zod JSON Schema conversion](https://zod.dev/json-schema), [Zod 4.6 keyword support](https://zod.dev/blog/zod-4-6), [Supabase pg_jsonschema](https://supabase.com/docs/guides/database/extensions/pg_jsonschema).
