# Who is Jane Doe

## JP

who is Jane Doe, and where does the Atlas roadmap stand?

## AI Assistant

Jane Doe works with you on Atlas; the roadmap targets a Q1 rollout and Q2 expansion.


<!-- CONTEXT-LOG
{
  "version": 2,
  "turns": [
    {
      "turn": 1,
      "queries": [
        "{ people(where: { nameContains: \"Jane Doe\" }) { path } }"
      ],
      "stats": {"kept":2,"pruned":0,"excluded":0,"docTokens":1200,"budget":300000,"scoring":"s3","floor":8.4,"floored":2},
      "universe": [
        {"path":"goals/2026.md","tokens":300,"pinned":true},
        {"path":"people/Jane-Doe.md","score":24,"tokens":900,"lex":8,"prov":"targeted"},
        {"path":"time/2026/01/26-01/01-27/day.md","score":8,"tokens":400,"cut":"floor"},
        {"path":"time/2026/01/26-01/01-27/actions/messages/slack_Atlas-Bot-to-atlas-general_Weekly-Digest.md","score":7.9,"tokens":1100,"lex":1.9,"cut":"floor"}
      ]
    },
    {
      "turn": 2,
      "queries": [
        "{ people(where: { nameContains: \"Jane Doe\" }) { path } }",
        "{ projects(where: { nameContains: \"Atlas\" }) { path } }"
      ],
      "stats": {"kept":3,"pruned":0,"excluded":0,"docTokens":2400,"budget":300000,"scoring":"s3","floor":8.4,"floored":2},
      "diff": [
        {"path":"projects/Atlas/Roadmap.md","score":18.5,"tokens":1200,"lex":6.2,"prov":"targeted"}
      ],
      "pruned": [
        {"path":"time/2026/01/26-01/01-27/day.md","score":8,"tokens":400,"cut":"floor"},
        {"path":"time/2026/01/26-01/01-27/actions/messages/slack_Atlas-Bot-to-atlas-general_Weekly-Digest.md","score":7.9,"tokens":1100,"lex":1.9,"cut":"floor"}
      ]
    }
  ]
}
-->
