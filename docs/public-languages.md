# Public website: Mongolian / English

## Scope

The public home page, equipment overview, four equipment detail pages, privacy policy, and data-deletion instructions support `mn` and `en`. Public customer sign-in, booking UI, and messages are included. The ERP/admin document, staff logic, backend, database, permissions, prices, booking identifiers and submitted values are not translated or changed.

Use the **Монгол / English** buttons. The preference is remembered under `cryo-public-language`. Explicit `?lang=mn` or `?lang=en` links take precedence. Private browsing/storage failure does not prevent switching. Without JavaScript the original Mongolian HTML remains readable.

## Translation model

This is automatic language switching using a bundled, reviewed copy catalogue, not a third-party machine-translation widget. No text or customer data is sent to a translation provider. Existing content is translated; future editorial text must be added to the catalogue before publication. Brands, model names, prices and customer-entered text stay intact.

- `public-copy.js`: homepage and booking text
- `public-device-copy.js`: existing public equipment copy
- `public-ui-copy.js`: public account messages, legal text, dynamic labels
- `public-i18n.js`: route-scoped presentation, persistence, observer and form-validation localisation
- `public-i18n.css`: public-only language-control styles

The catalogue uses one Mongolian source string, a TAB, then its English translation per line. Keep translations as plain text. Context-specific text-only elements can use `data-i18n-en`. Elements containing personal text must use `translate="no"` or `data-no-translate`; account names, email addresses and booking references are also excluded explicitly.

Option labels are translated only after their original submitted values have been preserved. Inputs, passwords and textarea values are never translated. The observer does not observe value attributes. Unknown copy is left visible rather than guessed.

## Verification

Run before release:

```sh
node scripts/test-public-i18n.cjs
node scripts/test-public-i18n-runtime.cjs
node scripts/test-booking-time.mjs
node scripts/test-booking-payment-ui.cjs
node scripts/build-public.mjs
```

The inventory test requires Python 3 (standard library only). The production build and browser runtime do not require Python or any new package.

For read-only local browser QA, run `node scripts/serve-public-i18n-preview.mjs` after building. It serves on `127.0.0.1:8735`, mocks the backend, blocks outgoing connections and refuses writes. `?fixture=customer&lang=en` shows a fictional customer whose Mongolian name deliberately matches a dictionary entry; it must remain unchanged. This fixture is not a real login or proof of payment/backend functionality. The test server and scripts are not included in the Vercel public build.

Check all pages, both languages, persistence across navigation/reload, 320px/390px mobile widths, public sign-in/registration labels, error feedback, booking dates/services/durations, summary, unchanged form values, keyboard focus, and browser console errors. Actual production purchases, appointments, cancellations or account changes are not needed for language QA.

## Boundaries

This release translates existing clinical/product statements and legal policy; it does not independently validate them or create new medical policy. Images/product markings are not rewritten. Full server-rendered multilingual SEO and future unknown copy auto-generation are not part of this release.

Rollback target before this change: Git main `668b5ed28b65de233162e8ec357dd311e88c8627`, Vercel production `dpl_9ZRahxZymNM6ibtCsFUpBrN49Yoq`. A rollback is an explicitly approved release action, not something the localisation script performs.
