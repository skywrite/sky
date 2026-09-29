import { addCalendarGuest, calendarGuestEmails } from '#lib/google/calendarGuests.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'Calendar guest entry waits for the exact suggestion and verifies the selected address', timeout: 20000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Calendar guest fixture\n', tempPrefix: 'sky-calendar-guests-' },
      async ({ page }) => {
        await page.setContent(`
      <section role="tabpanel" aria-label="Guests">
        <input role="combobox" aria-label="Guests">
        <div role="tree" aria-label="Guests invited to this event."></div>
      </section>
      <div role="listbox"><div role="option">Jane Doe jane@example.com</div></div>
      <button id="save">Save</button>
      <script>
        window.saves = 0;
        window.choices = [];
        const input = document.querySelector('input');
        const option = document.querySelector('[role=option]');
        const guests = document.querySelector('[role=tree]');
        option.dataset.email = 'jane@example.com';
        let sequence = 0;
        input.addEventListener('input', () => {
          const email = input.value;
          const current = ++sequence;
          setTimeout(() => {
            if (current !== sequence) return;
            option.dataset.email = email === 'missing@example.com' ? email + '.other' : email;
            option.textContent = 'Mock guest ' + option.dataset.email;
          }, 250);
        });
        option.addEventListener('click', () => {
          const email = option.dataset.email;
          window.choices.push(email);
          const row = document.createElement('div');
          row.setAttribute('role', 'treeitem');
          row.setAttribute('data-email', email === 'alias@example.com' ? 'different@example.com' : email);
          row.textContent = row.getAttribute('data-email');
          guests.append(row);
          input.value = '';
        });
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') option.click();
          if (event.key === 'Escape') document.querySelector('section').remove();
        });
        document.querySelector('#save').addEventListener('click', () => window.saves++);
      </script>
    `)
        page.setDefaultTimeout(1000)
        for (const email of ['alex@example.com', 'sam+work@example.com', 'jane@example.com'])
          await addCalendarGuest(page, email)
        await addCalendarGuest(page, 'JANE@example.com')
        assert({
          given: 'a portaled, delayed autocomplete with a stale previous suggestion and a repeated address',
          should: 'select each exact address once without closing the editor or pressing Save',
          actual: [await calendarGuestEmails(page), await page.evaluate(() => [window['choices'], window['saves']])],
          expected: [
            ['alex@example.com', 'sam+work@example.com', 'jane@example.com'],
            [['alex@example.com', 'sam+work@example.com', 'jane@example.com'], 0],
          ],
        })
        const missing = await addCalendarGuest(page, 'missing@example.com').then(
          () => '',
          (error: Error) => error.message,
        )
        const changed = await addCalendarGuest(page, 'alias@example.com').then(
          () => '',
          (error: Error) => error.message,
        )
        assert({
          given: 'a near-matching suggestion or a provider that substitutes a different address',
          should: 'stop with an actionable address-specific error without saving or accepting the substituted identity',
          actual: [missing, changed, await page.evaluate(() => window['saves'])],
          expected: [
            'Google Calendar could not select missing@example.com from its guest suggestions. Nothing was saved.',
            'Google Calendar did not keep alias@example.com in the guest list. Nothing was saved.',
            0,
          ],
        })
      },
    )
  },
)
