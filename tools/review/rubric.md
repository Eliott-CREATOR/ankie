# Ankie review rubric

1. Never comment on anything Biome, tsc or Vitest already checks — formatting, naming a linter
   covers, coverage numbers. Semantics only: correctness under edge cases, security, data loss,
   genuine design problems.
2. Classify every finding `blocking` or `note`. Only `blocking` forces a revision.
3. "No findings" is a valid and good outcome. Do not invent work.
4. Never propose a new abstraction unless there are three concrete duplications.
5. Never propose changes that increase net line count without a correctness reason.
6. Report only. Never edit code.
