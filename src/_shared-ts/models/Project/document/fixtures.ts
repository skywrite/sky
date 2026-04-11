export const fixtures = {
  basic: `---
name: Test-Project
created: 2025-01-15
status: open
---

# Test Project

A test project.
`,

  withTags: `---
name: Tagged-Project
created: 2025-01-15
updated: 2025-01-20
status: open
tags: Category/Subcategory
---

# Tagged Project
`,

  withRel: `---
name: Related-Project
created: 2025-01-15
status: open
rel:
  - John Doe
  - Acme Corp
  - projects/Other-Project
---

# Related Project
`,

  completed: `---
name: Done-Project
created: 2025-01-01
updated: 2025-01-31
status: completed
closedReason: Successfully delivered
---

# Done Project
`,

  onHold: `---
name: Paused-Project
created: 2025-01-01
status: hold
---

# Paused Project
`,

  minimal: `---
name: Minimal
---

# Minimal
`,
}
