# Recurring Pattern System

A flexible pattern matching system for defining recurring tasks and events.

## Usage

```typescript
import { matchesPattern, PatternMatcher } from './_recurring/mod.ts'

// Simple usage
const isToday = matchesPattern(new Date(), 'EVERY-MON')

// Class-based usage for repeated checks
const matcher = new PatternMatcher('MONTHLY-LAST-FRI')
const dates = [/* ... */]
const matchingDates = dates.filter(d => matcher.matches(d))
```

## Pattern Reference

### Daily/Weekly Patterns (EVERY- prefix)

| Pattern | Description |
|---------|-------------|
| `EVERY-DAY` | Every day |
| `EVERY-WEEKDAY` | Monday through Friday |
| `EVERY-WEEKEND` | Saturday and Sunday |
| `EVERY-MON` | Every Monday |
| `EVERY-TUE` | Every Tuesday |
| `EVERY-WED` | Every Wednesday |
| `EVERY-THU` | Every Thursday |
| `EVERY-FRI` | Every Friday |
| `EVERY-SAT` | Every Saturday |
| `EVERY-SUN` | Every Sunday |

### Monthly Patterns (MONTHLY- prefix)

#### Day-of-Week Based

| Pattern | Description |
|---------|-------------|
| `MONTHLY-FIRST-MON` | First Monday of each month |
| `MONTHLY-SECOND-TUE` | Second Tuesday of each month |
| `MONTHLY-THIRD-WED` | Third Wednesday of each month |
| `MONTHLY-FOURTH-THU` | Fourth Thursday of each month |
| `MONTHLY-LAST-FRI` | Last Friday of each month |
| `MONTHLY-LAST-SAT` | Last Saturday of each month |
| `MONTHLY-LAST-SUN` | Last Sunday of each month |
| `MONTHLY-LAST-WEEKEND` | Last weekend (Sat/Sun) of each month |

#### Fixed Date Based

| Pattern | Description |
|---------|-------------|
| `MONTHLY-1` | 1st of each month |
| `MONTHLY-15` | 15th of each month |
| `MONTHLY-31` | 31st of each month (skips months without 31 days) |
| `MONTHLY-LAST` | Last day of each month |
| `MONTHLY-LAST-1` | Second to last day of each month |
| `MONTHLY-LAST-2` | Third to last day of each month |
| `MONTHLY-LAST-N` | N days before month end |

### Quarterly Patterns (QUARTERLY- prefix)

| Pattern | Description |
|---------|-------------|
| `QUARTERLY-FIRST-MON` | First Monday of each quarter |
| `QUARTERLY-LAST-FRI` | Last Friday of each quarter |
| `QUARTERLY-1` | First day of each quarter |
| `QUARTERLY-15` | 15th day of each quarter |
| `QUARTERLY-LAST` | Last day of each quarter |
| `QUARTERLY-LAST-1` | Second to last day of each quarter |
| `QUARTERLY-LAST-N` | N days before quarter end |

### Every Other Day Patterns (EVERY-OTHER-DAY- prefix)

| Pattern | Description |
|---------|-------------|
| `EVERY-OTHER-DAY-A` | Every other day (Day A, starting from epoch Jan 1, 2024) |
| `EVERY-OTHER-DAY-B` | Every other day (Day B, opposite of Day A) |

Day A = even days from epoch (0, 2, 4...)
Day B = odd days from epoch (1, 3, 5...)

The epoch-based approach ensures the pattern is consistent across years without resetting at year boundaries.

### Bi-Weekly Patterns (EVERY-2-WEEKS- prefix)

| Pattern | Description |
|---------|-------------|
| `EVERY-2-WEEKS-A-MON` | Every other Monday (Week A, starting from first Monday of year) |
| `EVERY-2-WEEKS-B-MON` | Every other Monday (Week B, opposite of Week A) |
| `EVERY-2-WEEKS-A-TUE` | Every other Tuesday (Week A) |
| `EVERY-2-WEEKS-B-TUE` | Every other Tuesday (Week B) |
| `EVERY-2-WEEKS-A-WED` | Every other Wednesday (Week A) |
| `EVERY-2-WEEKS-B-WED` | Every other Wednesday (Week B) |
| `EVERY-2-WEEKS-A-THU` | Every other Thursday (Week A) |
| `EVERY-2-WEEKS-B-THU` | Every other Thursday (Week B) |
| `EVERY-2-WEEKS-A-FRI` | Every other Friday (Week A) |
| `EVERY-2-WEEKS-B-FRI` | Every other Friday (Week B) |
| `EVERY-2-WEEKS-A-SAT` | Every other Saturday (Week A) |
| `EVERY-2-WEEKS-B-SAT` | Every other Saturday (Week B) |
| `EVERY-2-WEEKS-A-SUN` | Every other Sunday (Week A) |
| `EVERY-2-WEEKS-B-SUN` | Every other Sunday (Week B) |

Week A starts from the first occurrence of that weekday in the year. Week B is the opposite week.

### Alternating Patterns (ALTERNATE- prefix) — Deprecated

These patterns still work but are deprecated in favor of `EVERY-2-WEEKS-A-*`:

| Pattern | Equivalent |
|---------|------------|
| `ALTERNATE-MON` | `EVERY-2-WEEKS-A-MON` |
| `ALTERNATE-TUE` | `EVERY-2-WEEKS-A-TUE` |
| `ALTERNATE-WED` | `EVERY-2-WEEKS-A-WED` |
| `ALTERNATE-THU` | `EVERY-2-WEEKS-A-THU` |
| `ALTERNATE-FRI` | `EVERY-2-WEEKS-A-FRI` |
| `ALTERNATE-SAT` | `EVERY-2-WEEKS-A-SAT` |
| `ALTERNATE-SUN` | `EVERY-2-WEEKS-A-SUN` |

## Examples

```typescript
// Check if today is the last Friday of the month
if (matchesPattern(new Date(), 'MONTHLY-LAST-FRI')) {
  console.log('Time for monthly reports!')
}

// Check if today is a weekday
if (matchesPattern(new Date(), 'EVERY-WEEKDAY')) {
  console.log('Working day')
}

// Check if today is 5 days before month end
if (matchesPattern(new Date(), 'MONTHLY-LAST-5')) {
  console.log('Prepare month-end tasks')
}

// Check if today is the first Monday of the quarter
if (matchesPattern(new Date(), 'QUARTERLY-FIRST-MON')) {
  console.log('Quarterly planning meeting')
}

// Check if this is a Week A or Week B Friday
if (matchesPattern(new Date(), 'EVERY-2-WEEKS-A-FRI')) {
  console.log('Week A tasks')
} else if (matchesPattern(new Date(), 'EVERY-2-WEEKS-B-FRI')) {
  console.log('Week B tasks')
}

// Alternate tasks between Day A and Day B
if (matchesPattern(new Date(), 'EVERY-OTHER-DAY-A')) {
  console.log('Day A: strength training')
} else {
  console.log('Day B: cardio')
}
```

## Design Principles

1. **Clear Prefixes**: Every pattern starts with a frequency indicator (`EVERY-`, `EVERY-OTHER-DAY-`, `EVERY-2-WEEKS-`, `MONTHLY-`, `QUARTERLY-`)

2. **Natural Language**: Patterns read like English (`MONTHLY-FIRST-MON` = "Monthly, first Monday")

3. **Consistent Naming**:
   - Ordinals (`FIRST`, `SECOND`, `THIRD`, `FOURTH`, `LAST`) for day-of-week patterns
   - Numbers (`1`, `15`, `31`) for fixed calendar dates
   - `LAST-N` for counting backward from period end

4. **Case Insensitive**: Patterns work regardless of case (`monthly-first-mon` = `MONTHLY-FIRST-MON`)

5. **Predictable Behavior**:
   - `MONTHLY-31` skips months without 31 days (no February 31st)
   - `MONTHLY-LAST` always matches the actual last day
   - `EVERY-2-WEEKS-A/B-` patterns reset each year based on the first occurrence

## Implementation Notes

- All `LAST-N` patterns count calendar days, not business days
- Quarters are calendar quarters: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
- Every other day patterns (`EVERY-OTHER-DAY-A/B`) use Jan 1, 2024 as fixed epoch for consistent cross-year behavior
- Bi-weekly patterns (`EVERY-2-WEEKS-A/B-`) use the first occurrence in the current year as reference
- Pattern matching handles year boundaries correctly (e.g., last day of December)

## Related Files

Pattern definitions are centralized in a shared module:

| File | Purpose |
|------|---------|
| `_shared-ts/universal/dates/recurring/patterns.ts` | **Single source of truth** for all pattern definitions |

When adding or modifying patterns, update `patterns.ts` only. These files import from it automatically:

| File | What it imports |
|------|-----------------|
| `extensions/vscode/src/completions/RecurringPatternCompletionProvider.ts` | `patterns` array for autocomplete |
| `extensions/vscode/src/highlighters/RecurringPatternHighlighter.ts` | `isValidPattern()` for syntax highlighting |
| `tasks/all/day/_recurring/PatternMatcher.ts` | `isValidPattern()` for validation |

## Future Enhancements

Potential additions that could be implemented:
- `EVERY-N-DAYS` - Every N days from a reference date
- `MONTHLY-WEEKDAY-LAST-N` - N weekdays before month end
- `YEARLY-MM-DD` - Specific date each year
- Pattern validation utilities
- Next/previous occurrence calculators