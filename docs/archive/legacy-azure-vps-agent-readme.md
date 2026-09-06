# HCW VPS Lab Agent

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


This is the Azure-native version of the VPS lab agent. It pulls sandbox execution jobs from Azure Cosmos DB instead of Firebase Firestore.

## Setup
1. Copy `.env.example` to `.env` and fill in your Cosmos DB credentials.
2. Run `npm install`
3. Run `npm start`

## TODO
- [ ] Migrate `lib/capabilities.js` from the original codebase
- [ ] Migrate `lib/docker-runner.js` from the original codebase
- [ ] Implement Cosmos DB change feed or interval polling in `index.js`
- [ ] Set up PM2 or systemd service for daemonization
