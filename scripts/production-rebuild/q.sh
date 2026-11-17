#!/bin/bash
# q.sh <project-ref> <sql-file>   -- runs SQL through the Management API, prints JSON
curl -sS --max-time 600 -X POST "https://api.supabase.com/v1/projects/$1/database/query" -H "Content-Type: application/json" --data-binary @<(jq -Rs '{query:.}' < "$2")
