## Problem Statement

用户在多个 worktree 和 session 之间切换时，难以快速分辨项目长期目标、当前会话任务和刚完成的一轮工作。现有 recap 不能同时提供跨 worktree 的已确认项目上下文、可恢复的会话卡片及每轮进展；直接照搬 Pi 扩展又会引入不符合本项目选择的自动修复、额外数据留存及主模型副作用。

当前定制 TUI 还需要适配 DeepSeek Harness 0.2.1-rc.2。只修改兼容声明或证明模块可导入，不能证明插件可正常启动、会话操作可用或打包产物可安装。多代理并行开发还需要隔离工作区、明确依赖以及每次集成后的可重复验证。

## Solution

在保留现有定制行为与宿主安全边界的前提下，完成目标 Harness 版本的兼容适配，并提供面向用户的 Context Hint：

- **Project Card**：同仓 worktree 共享的项目目标、约束和已确认关键决策。
- **Session Card**：当前会话的任务目标、状态、阻塞和下一步。
- **Turn Card**：本轮完成事项、发现、实际验证结果，以及失败或取消。

卡片默认折叠为“当前进展 → 下一步”，可以展开三层详情。用户按项目首次手动开启后，在交互结束时自动后台更新；摘要模型可独立选择。卡片只供人参考，不自动注入主模型，不替代真实会话日志或验证证据。Project Suggestion 必须由用户确认后才能影响共享卡片。

首版同时交付隔离 profile 下的真实启动与用户路径验证、项目级 verification skill，以及 PR、integration 和 main 的明确 CI 检查。以下均为待实现及验收要求，不代表已经通过测试。

## User Stories

1. As a developer, I want the customized TUI to start on DeepSeek Harness 0.2.1-rc.2, so that I can use the new host without relying on a compatibility exemption.
2. As an existing user, I want unrelated customizations and declared compatibility safeguards preserved, so that the upgrade does not silently replace my working environment with a different distribution.
3. As a developer, I want to enable Context Hint explicitly for a project, so that no summary requests begin before I opt in.
4. As a user, I want the enable flow to explain the selected summary model and content sent to it, so that I understand the data boundary.
5. As a multi-worktree developer, I want a shared Project Card, so that I can recover stable project context from any worktree of the same repository.
6. As a multi-session developer, I want each Session Card isolated, so that one task's blockers and next steps do not overwrite another task's state.
7. As a developer, I want a Turn Card describing the latest interaction, so that I can distinguish new progress from the broader session summary.
8. As a user, I want a concise collapsed progress-and-next-step line, so that the feature remains useful without occupying the conversation screen.
9. As a user, I want Alt+O and a command entry point to expand or collapse the cards, so that I can inspect details even when my terminal handles shortcuts differently.
10. As a user, I want the shortcut to be configurable without overriding reserved or higher-priority interactions, so that existing keyboard workflows continue to work.
11. As a typing user, I want background updates to preserve focus, input and scroll position, so that summaries do not interrupt my work.
12. As a user, I want at most one automatic summary request per completed interaction, so that tool steps and streaming tokens do not multiply calls.
13. As a user, I want failed and cancelled interactions described truthfully, so that an interrupted action is not presented as completed work.
14. As a returning user, I want existing cards restored without a new request when no new interaction occurred, so that opening a session does not cause duplicate charges.
15. As a user, I want summary generation to inherit my current session model by default, so that I can start without configuring a second model.
16. As a user, I want to select a separate Summary Model, so that I can choose a different provider or cost profile without changing the main session model.
17. As a user, I want an unavailable selected Summary Model to fail explicitly, so that content is not silently sent to another model or provider.
18. As a user, I want bounded request input, output and duration, so that summary work cannot grow or wait indefinitely.
19. As a user, I want a failed update to retain the Last Valid Card with a visible failure marker, so that useful context is not replaced by an empty success.
20. As a user, I want manual retry and pause controls without automatic repair or retry, so that I control additional summary attempts.
21. As a user, I want malformed JSON and missing required fields to be rejected safely, so that model variability does not crash the TUI or corrupt cards.
22. As a developer switching from session A to B, I want delayed A results fenced from B, so that asynchronous summaries never contaminate another task.
23. As a user, I want disabling or deleting a hint to prevent in-flight work from restoring it, so that my control takes effect reliably.
24. As a user, I want project-level model suggestions shown for confirmation, so that a temporary branch assumption cannot silently become a shared project rule.
25. As a developer using concurrent worktrees, I want confirmed project updates not to be silently lost, so that simultaneous work does not overwrite shared decisions.
26. As a user rewinding a session, I want incompatible Session and Turn cards hidden as pending update, so that conclusions from the abandoned timeline are not shown as current progress.
27. As a user forking a session, I want the new session not to inherit a misleading completed state, so that its own progress starts accurately.
28. As a user, I want Project context unaffected by a single session's rewind, so that shared decisions are not undone by local navigation.
29. As a user, I want rewind and fork to wait for manual refresh or the next completed interaction before regeneration, so that navigation alone does not trigger extra model calls.
30. As a returning user, I want the latest project and per-session cards persisted locally, so that restarting does not erase my recovery cues.
31. As a privacy-conscious user, I want no additional default archive of summary generations, raw prompts or tool outputs, so that this feature does not create another transcript collection.
32. As a user, I want scoped controls for deleting hint data, so that I can remove it without deleting original sessions or project files.
33. As a user, I want storage failures and capacity limits reported without losing existing cards, so that optional hints cannot damage the main session.
34. As an existing recap user, I want Context Hint to suppress duplicate automatic recap calls while preserving manual recap, so that enabling it does not run two automatic summaries.
35. As an existing recap user, I want disabling Context Hint to restore my previous automatic recap preference, so that trying the feature does not permanently change another setting.
36. As a terminal user, I want usable cards in narrow terminals, inline and fullscreen modes, and Chinese and English interfaces, so that the feature fits supported TUI environments.
37. As a maintainer, I want to install and drive the built plugin through a real Harness in an isolated profile, so that source-only tests cannot hide broken package entry points or host loading.
38. As a maintainer, I want deterministic model-boundary fixtures instead of real credentials in required CI, so that tests are reproducible and do not cause paid model calls.
39. As an implementation agent, I want a proven project verification skill with retained evidence and scoped cleanup, so that I can independently demonstrate observable behavior.
40. As a coordinator, I want ticket work verified before integration and CI rerun on integration and main, so that independently passing branches do not conceal merge regressions.
41. As a user, I want implementation and acceptance coordinated from one conversation, so that I do not need to manage worker sessions or resolve their dependencies myself.
42. As a user, I want real-provider tests, formal releases and changes to my installed TUI or CLI kept behind separate authorization, so that development verification does not alter my production environment.

## Implementation Decisions

### 1. Ownership and host compatibility

- Preserve DeepSeek Harness ownership of agents, sessions, model/provider discovery, tools, credentials and authoritative persistence. Context Hint is an optional Cordis extension and TUI projection, not a replacement runtime or an additional conversation truth store.
- Use the agreed target Harness 0.2.1-rc.2 explicitly; a future upstream release is not an implicit scope change. Adapt the real exported plugin shapes and host lifecycle rather than bypassing version checks. Preserve unrelated privacy defaults and existing custom behavior.
- Keep official host imports behind the existing adapter boundary. Reuse supported status, shortcut and scene/panel extension seams that are actually available in the chosen checkout; do not assume a newer upstream panel API already exists here.
- Keep compatibility declarations, dependencies, source checks and existing supported-version safeguards consistent. Any inability to retain a declared compatibility line is a reported scope decision, not silent deletion of a failing check.

### 2. Project and session identity

- Resolve linked worktrees of the same repository to one canonical Project identity using their shared Git repository identity. Distinct clones are not implicitly merged by remote URL, repository name or branch name. No cross-directory shared identity for unrelated non-Git folders is promised by this first version.
- Project Cards contain stable context, not a branch's task progress. Session and Turn data belong to the captured session and its applicable timeline; a branch name alone is not a session key.
- The model may propose Project Suggestions in the same summary response, but only explicit human confirmation applies them. Confirmation must account for a shared card changed by another worktree; silently overwriting an intervening confirmed update is not acceptable.

### 3. Activation, generation and model selection

- Default to disabled until the user enables the feature for that Project after disclosure of the summary provider/model and selected content sent. Provide pause, resume, manual refresh/retry and disable controls.
- Generate once after an actual user interaction settles, including truthful failure/cancellation outcomes; not once per tool call, streamed token or repaint. The request may update Session and Turn and propose Project changes together.
- Opening or restoring a session without new work does not generate a request. Fork and rewind are invalidation events, not automatic summary triggers. They wait for an explicit refresh or a subsequent completed interaction.
- Default Summary Model selection inherits the current session model for that request; an explicit selection is independent. Never change the main session model, copy credentials into a second store, or silently fall back to another model/provider.
- Capture the owning Project, session and applicable event position before asynchronous work. Switching, disabling, deletion and invalidation must prevent late completion from updating the wrong or no-longer-valid state.
- Each interaction permits at most one automatic request at the Context Hint layer. Do not schedule automatic repair or retries; inspect the provider path during implementation so hidden retry behavior cannot invalidate the reported call count. Manual retries are explicit additional requests.
- Enforce finite input, output and timeout limits with documented defaults. Exact limits are implementation parameters to be recorded in configuration/help and exercised by boundary tests; request counts and character limits are not represented as a monetary spending guarantee.

### 4. Content validity and timeline changes

- Validate structured results at runtime before changing any card. Missing required turn data, invalid structures, empty-success fallbacks and model/transport failures must not erase useful state.
- For an ordinary failed update on the same timeline, retain the Last Valid Card and mark the failed update visibly. Its older content must not be labeled as up to date.
- After rewind, hide Session/Turn cards that are no longer applicable and display pending update. Do not invent an exact earlier summary when no summary history was saved. A fork must not blindly adopt the parent's completed state. The shared Project Card does not roll back with an individual session.
- Treat summary text as untrusted display data, not instructions or evidence of work having happened. Never insert generated assistant/tool facts into the authoritative transcript or automatically inject cards into the main model context.

### 5. Persistence, privacy and existing recap

- Persist the latest Project Card and latest applicable cards for each session using the established plugin-storage boundary. Keep storage and work queues bounded and validate persisted content when reading.
- Do not create an extra default archive of generations, raw prompts or tool results. Reusing source content for a bounded request does not authorize independently retaining copies. Summaries themselves may contain sensitive information; do not describe them as inherently secret-free or encrypted.
- Provide scoped hint-data deletion without deleting original transcripts, project files or credentials. Shared Project deletion requires an explicit indication that it affects linked worktrees. Old in-flight results cannot repopulate deleted data.
- Handle capacity, corruption and concurrent project updates explicitly; report a failed write without silently deleting unrelated cards or breaking the host session. Atomic replacement of one file is not sufficient proof that a multi-step shared update is safe.
- While enabled, suppress the old automatic recap trigger to avoid duplicate automatic summary requests. Preserve manual recap and restore the previously effective automatic recap preference on disable; do not permanently overwrite it merely to coordinate the two features.

### 6. TUI experience

- Use one concise collapsed line showing progress and next action. Alt+O is the intended expand/collapse default, with configurable shortcut and a command alternative. Existing reserved keys, modal priority and user bindings must remain respected.
- Show the three scopes distinctly, including which session/worktree is being described and visible pending, stale or failed-update states. Confirmation/rejection of a Project Suggestion is an explicit user action, not a side effect of opening the cards.
- Background generation and completion do not steal focus, change input or scroll position, or flood the transcript. Constrain large and untrusted content to the available terminal layout.
- Follow existing Chinese/English UI conventions and keep user-facing help, configuration, shortcut and limitation documentation synchronized.

### 7. Delivery and coordination

- Use the user's fork and configured GitHub tracker; do not write issues, PRs or implementation changes to upstream repositories.
- After spec review and ticket-breakdown approval, work a dependency graph on one integration branch. Each implementation ticket gets an isolated worktree and branch, test-first implementation, evidence-based acceptance and a separate merger role. This coordinator conversation remains the user's sole interface.
- Reuse and extend existing CI instead of replacing safeguards with a new parallel framework. Required checks must cover relevant build, package, adapter, existing regression and new feature behavior. Missing, cancelled or failed required tests are not a passing result.
- PRs and integration-branch pushes must run the applicable checks; merging to main must trigger another run against the resulting main commit. Required Linux and macOS coverage must include the real packed-plugin startup path, not just entry imports. This spec makes no new Windows support promise.
- CI workflow configuration is distinct from enforced repository branch rules. Report their actual states separately. Changing repository permissions or branch-protection rules still requires explicit authorization; a green workflow alone is not claimed to prevent an unchecked merge.
- Package verified artifacts for clean-install testing without an npm publish or formal release. Do not install them into the user's active profile as a verification shortcut.

## Testing Decisions

### Highest-level acceptance seam

The user has confirmed this seam: launch a real target Harness with the built plugin installed from its package artifact into an empty, isolated profile; drive ordinary TUI commands and keys through a PTY; observe the composed terminal and actual persisted hint state. Replace only the external model-provider boundary with a deterministic test service. Do not fake the host loader, session lifecycle or UI setters in the final acceptance path.

Reuse existing terminal settling, composed-screen assertions, isolated-home helpers and actual command-path regression patterns. Existing recap, session-browser, terminal-input, migration and package checks are useful prior art, not a substitute for the packed-plugin integration run. Focused pure-result validation tests may supplement this top seam for malformed outputs and boundary values.

### Required observable scenarios

1. **Host and packaging**: clean package install, expected target version, plugin admitted without compatibility bypass, usable prompt, a user interaction with the test provider, session restore, and clean terminal/process teardown. Exercise the migration path affected by the persistence-plugin export change so import/link success alone cannot conceal it.
2. **Activation and privacy**: no summary request before opt-in; verify the content and model destination of a request. All model-phase traffic in required tests stays within the local test boundary. Test credentials are synthetic and logs/artifacts must not contain real keys or private conversations.
3. **Cards and controls**: manual refresh, automatic settled update, collapsed/expanded views, shortcut remapping and command fallback; maintain focus, input and scroll position in narrow, inline/fullscreen and Chinese/English cases.
4. **Counts and failures**: count requests through the provider boundary; multiple tool events still produce one automatic summary, restore without new work produces none, and malformed/missing turn data, timeout, unavailable model or cancellation never produces an empty success or automatic retry. Manual retry is observable as an explicit additional request.
5. **Model independence**: inherit versus explicitly selected Summary Model, persisted selection and unavailable selection behavior; compare the real main-session selection before and after generation so a hidden model switch fails the test.
6. **Identity and concurrency**: two linked worktrees share Project context but not Session/Turn progress; distinct clones do not accidentally share it. Confirm/reject Project Suggestions and race two shared updates without losing an accepted change.
7. **Late results and lifecycle**: hold A's provider response, switch to B, then release it and prove B's visible and stored cards unchanged. Repeat invalidation around disable, deletion and shutdown. Rewind hides abandoned-timeline conclusions, fork does not inherit a false done state, and neither navigation event automatically calls the model.
8. **Persistence**: restart restores applicable latest cards, ordinary update failure retains the Last Valid Card, deletion affects only the selected hint scope, and corrupt/full/unwritable storage leaves the authoritative session intact. Demonstrate that no extra prompt/tool or generation-history archive is created.
9. **Recap coexistence**: enabled hints prevent duplicate automatic recap calls, manual recap still works, and disabling restores the prior effective preference.
10. **Integration**: existing required regressions remain enabled, each integrated result is checked, and the final main commit receives a new CI run. Report any existing non-required or unstable coverage explicitly rather than claiming all possible behavior is proven.

### Verification skill and evidence

- Produce a project-local skill named verify with grounded Launch, Doctor, Drive, Evidence, Cleanup and Helpers instructions, plus a small feature map for the actual user entry points.
- First establish that the checkout builds and the isolated app reaches a usable state. A verification skill that assumes an unbuildable or unstartable base is not delivered as working.
- Execute the skill end to end for at least one mapped real feature before handing it over. Capture the action, resulting terminal state, relevant stored state and request counts, not only a final screenshot or successful import.
- Cleanup targets only processes and scratch state created by the run; it never kills by process name or deletes the retained evidence. Confirm evidence still exists after cleanup.
- Required CI uses synthetic conversations and deterministic provider fixtures, never the user's real credentials or paid model calls. Real-provider smoke is separate, optional and requires authorization; fixture-based success is not claimed as proof that every real model obeys the output contract.
- Ordinary tests, existing version contracts and storage primitives are preferred. Do not add new hashes, frozen baselines or bespoke gates without a concrete failure case that normal mechanisms cannot address. Tests reduce known regression risk; they do not prove the absence of every possible bug.

## Out of Scope

- Installing the Pi extension into this environment, or copying its automatic repair, extra evidence archive or main-model restoration side effects.
- Automatically injecting summaries as AI memory, changing the authoritative transcript, or replacing host-owned model, tool, credential and session services.
- Exact historical summary restoration after rewind; indefinite summary history; cloud synchronization; automatic sharing between independent clones or unrelated folders.
- Autonomous application of Project Suggestions, silent model/provider fallback, or a promise of perfect secret detection in arbitrary content.
- Cross-agent monitoring/notifications, a new general panel framework, or unrelated renderer, provider, plugin and architecture refactors.
- Desktop-app customization, additional shell uninstall work, a new Windows support guarantee, or silently chasing a later host version than the agreed target.
- Paid/real-provider test calls, replacement of the user's active TUI/CLI installation, npm publishing, formal GitHub releases, and unapproved credential, permission or branch-rule changes.
- Starting implementation merely because this parent spec carries the ready-for-agent label. User approval of the spec and ticket breakdown is still required before implement-spec begins.

## Further Notes

本规格综合用户已确认的 11 项设计决定、当前定制 TUI 的源码接入核查，以及 Pi Context Hint 发布包的源码研究。Pi 的行为只作参考；与本规格冲突时，以用户确认的本项目选择为准，尤其是无自动 repair、无额外摘要历史、无主模型副作用及 rewind 后不伪造历史卡片。

当前规格发布用于用户审阅，不代表实现已启动。此前六张票只是拆分草案，正式票数、粒度和阻塞关系由后续 to-tickets 展示并经用户确认。没有在本轮执行构建、功能验收或 CI，也没有授权正式发布或替换现用安装。
