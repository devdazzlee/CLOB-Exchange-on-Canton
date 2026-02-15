#!/bin/bash
curl -s -X POST http://localhost:3001/api/onboarding/allocate-party \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"publicKey":"dGVzdA=="}'
