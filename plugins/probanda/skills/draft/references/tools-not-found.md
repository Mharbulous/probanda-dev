Read when: the opening ToolSearch and its one retry did not return drafting_forms__open_session, and the session has stopped (SKILL.md section 6, "Tools not found").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 6: Tools not found, the two cases

- **A Chat conversation, not a Cowork task.** This is the case when this file was read from a path under `/mnt/skills/plugins/`, or when the session's file and shell tools are `view` and `bash_tool` rather than `Read` and `Bash`. A Chat conversation never loads the Probanda plugin's tools, and no reinstall or restart changes that. Say so in one line, then tell the practitioner to start a Cowork task (not a chat), in the same Project if they are in one, and run `/probanda:draft` there. Give no re-import or restart steps, and do not ask for the matter folder.
- **Otherwise (a Cowork task).** Tell the practitioner, in this order: re-import the latest litigation `.plugin` if a newer one exists; quit Claude completely from the system tray (closing the window is not enough); relaunch it; start a new Cowork task; run `/probanda:draft` again. In the same message, ask for the matter folder only if this session cannot already see it.
