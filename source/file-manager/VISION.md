# file-manager — Vision

`file-manager` holds every Probanda capability that renames, moves, changes or deletes a file on the practitioner's computer that Probanda did not create, so that one switch removes them all. A practitioner who wants Probanda without that power disables this plugin and keeps everything else: without it, Probanda only reads or copies those files, and creates, changes and deletes only files it created itself.

It requires `lawyer`. Its one reach beyond `lawyer`, `/housekeeping`'s re-point of a moved file in `/drafting-data`, is skipped when `litigator` is not installed. A skill elsewhere that would move or trash a file calls into `file-manager` only conditionally: when it is absent, the step stops and tells the practitioner, and never falls back to a shell move or delete.

The vision, the design principles and the anti-patterns that govern all five Probanda plugins are in the `VISION.md` of the `lawyer` plugin. They apply here unchanged.
