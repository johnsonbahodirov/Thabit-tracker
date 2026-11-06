# Thabit Habit Tracker

A private, offline-first habit tracker. The app has no runtime dependencies, account, backend, or analytics; habit data is stored in this browser.

## Run

Requires Python 3 and a modern browser.

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173). The app shell is cached for offline use after the first successful load. PWA installation and service workers require localhost or HTTPS.

## Verify

```sh
npm test
```

## Data and reminders

Use Profile to export a JSON backup or CSV completion history, and validate/restore a JSON backup. Clearing this browser's site data removes local records, so keep a backup somewhere safe. Reminder checks run while the app is open; background delivery depends on browser and platform support.