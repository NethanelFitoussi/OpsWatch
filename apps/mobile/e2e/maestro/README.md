# Maestro flows (emulators, simulators and devices)

Critical end-to-end journeys, run against a development or preview build of the app.

```sh
# Install Maestro once: https://maestro.mobile.dev
curl -fsSL "https://get.maestro.mobile.dev" | bash

# With the app installed on a booted simulator/emulator (APP_ID = your bundle id / package, com.example.opswatch by default):
maestro test -e APP_ID=com.example.opswatch e2e/maestro
# Flows against the mock server need it running and reachable (10.0.2.2 from the Android emulator):
npm run mock-server
maestro test -e APP_ID=com.example.opswatch -e SERVER_URL=http://10.0.2.2:4010 e2e/maestro/login-mock-server.yaml
```

The flows use the same `testID`s as the Jest and Playwright tests. `demo-*.yaml` flows need no server.
