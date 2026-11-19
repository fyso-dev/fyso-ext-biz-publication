#!/usr/bin/env bash
set -euo pipefail
exec node extensions/biz-publication/connector.cjs doctor
