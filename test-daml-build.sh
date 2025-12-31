#!/bin/bash
export PATH="$HOME/.daml/bin:$PATH"
cd daml
daml build 2>&1 | tail -10
