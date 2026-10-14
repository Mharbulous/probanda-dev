# file-admin — Vision

`file-admin` holds every Probanda capability that renames, moves or deletes the practitioner's own files, so that one switch removes them all. A practitioner who wants Probanda without that power disables this plugin and keeps everything else.

It requires `practice`. Its one reach beyond `practice`, `/housekeeping`'s re-point of a moved file in `/drafting-data`, is skipped when `litigator` is not installed. A skill elsewhere that would move or trash a file calls into `file-admin` only conditionally: when it is absent, the step stops and tells the practitioner, and never falls back to a shell move or delete.

The vision, the design principles and the anti-patterns that govern all five Probanda plugins are in the `VISION.md` of the `practice` plugin. They apply here unchanged.
