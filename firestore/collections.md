# Firestore collections

Firestore is schemaless — collections appear the moment the API writes its
first document. There's nothing to "run" the way you would in SQL. This file
documents the shape of each document so you (and future you) know what to
expect.

## `leads`

One document per form submission.

| field          | type         | notes                                              |
| -------------- | ------------ | -------------------------------------------------- |
| `created_at`   | timestamp    | server timestamp                                   |
| `status`       | string       | `new` \| `contacted` \| `meeting_booked` \| `won` \| `lost` |
| `first_name`   | string       | required                                           |
| `last_name`    | string       | required                                           |
| `email`        | string       | required, lowercased                               |
| `phone`        | string\|null |                                                    |
| `interest`     | string       | one of the four form options                       |
| `message`      | string\|null | optional free-text                                 |
| `ip_address`   | string\|null | real client IP (X-Forwarded-For)                   |
| `user_agent`   | string\|null |                                                    |
| `referrer`     | string\|null |                                                    |
| `landing_page` | string\|null | first page they hit in the session                 |
| `utm_source`   | string\|null |                                                    |
| `utm_medium`   | string\|null |                                                    |
| `utm_campaign` | string\|null |                                                    |
| `utm_content`  | string\|null |                                                    |
| `utm_term`     | string\|null |                                                    |
| `sa_click_id`  | string\|null | StackAdapt click id from URL                       |

## `pageviews`

One document per landing page visit.

| field          | type         | notes                          |
| -------------- | ------------ | ------------------------------ |
| `created_at`   | timestamp    | server timestamp               |
| `ip_address`   | string\|null |                                |
| `user_agent`   | string\|null |                                |
| `referrer`     | string\|null |                                |
| `path`         | string\|null |                                |
| `query_string` | string\|null |                                |
| `utm_source`   | string\|null |                                |
| `utm_medium`   | string\|null |                                |
| `utm_campaign` | string\|null |                                |
| `utm_content`  | string\|null |                                |
| `utm_term`     | string\|null |                                |
| `sa_click_id`  | string\|null |                                |

## Indexes

Firestore auto-creates single-field indexes on every field, so simple
queries (e.g. "all leads where utm_source = stackadapt, sorted by date")
just work.

You only need a **composite index** if you query on two fields at once
(e.g. `where utm_source == 'stackadapt' and utm_campaign == 'q2'
order by created_at desc`). If you try, the Firebase Console will throw
an error with a one-click link to create the index. Click it and wait
~30 seconds.

## Security rules

This project does **not** use the Firestore client SDK from the browser.
Only the Node API writes (and reads) using the Admin SDK. Recommended
security rules — paste into Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This blocks all browser access. The Admin SDK in `server/` bypasses these
rules entirely, so the API keeps working — but nobody can scrape your
leads by guessing collection names.
