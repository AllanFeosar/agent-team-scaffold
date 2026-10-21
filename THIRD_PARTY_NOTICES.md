# Third-party notices

## llm-council (assets/llm-council/)

The council skill's three-phase method (independent answers → anonymous cross-ranking → chairman
synthesis) is adapted from the `llm-council` skill in
[dair-ai/dair-academy-plugins](https://github.com/dair-ai/dair-academy-plugins), itself an
implementation of Andrej Karpathy's LLM Council idea. The transport was rewritten (single-provider
subagents and read-only CLI calls instead of Fireworks AI API calls), but the method and structure
are derived from the original, so its license notice is reproduced here as MIT requires.

```
MIT License

Copyright (c) 2026 Elvis Saravia and DAIR.AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Octogent tentacle convention

The `.agent-team/tentacles/<agent>/CONTEXT.md` and `todo.md` file shapes follow the convention of
[hesamsheikh/octogent](https://github.com/hesamsheikh/octogent), as noted in
`assets/tentacle-context.template.md`.
