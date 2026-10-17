// Replays shell commands through guard-commandments.js. Run: node guard-commandments.test.js
const { execFileSync } = require("child_process");
const path = require("path");
const HOOK = path.join(__dirname, "guard-commandments.js");
const F = "COMMANDMENTS" + ".md";

const pass = [
  `sed -n '1,5p' ${F}`,
  `sed -n 1,5p ${F} | head`,
  `jq . ${F}`,
  `find . -name ${F}`,
  `cp ${F} /tmp/x`,
  `git checkout -- src/a.js && cat ${F}`,
  `git grep -l foo -- ${F}`,
  `git ls-files ${F}`,
  `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"cat ${F}"}}' | node .claude/hooks/guard-commandments.js`,
  `git commit -m "Edit ${F}; (keep wording)" -- ${F}`,
  `git show HEAD@{1}:${F}`,
];
const deny = [
  `sed -i 's/a/b/' ${F}`,
  `sed -n 'w ${F}' x`,
  `sed -n '1p' x > ${F}`,
  `sed -n 1p ${F} -i`,
  `awk 'NR<5' ${F}`,
  `python scripts/x.py --check ${F}`,
  `python -c "open('${F}').read()"`,
  `git checkout src/a.js ${F}`,
  `git restore ${F}`,
  `cp /tmp/x ${F}`,
  `cp ${F} ${F}.bak && mv x ${F}`,
  `cp -l ${F} /tmp/x`,
  `mv ${F} /tmp/x`,
  `rm ${F}`,
  `find . -name ${F} -delete`,
  `find . -name ${F} -exec rm {} \\;`,
  `find . -name ${F} -fprint ${F}`,
  `cat x | tee ${F}`,
  `cat x > ${F}`,
  `Get-Content ${F} | Set-Content ${F}`,
  `git diff --output=${F}`,
  `jq . x > ${F}`,
  `cat ${F} | sort -o ${F}`,
  `cat ${F} | uniq - ${F}`,
  `git grep -O"sed -i s/a/b/" a -- ${F}`,
  `git grep --open-files-in-pager=vi a -- ${F}`,
  `rg --pre ./x.sh a ${F}`,
  `git -c "diff.external=./x.sh" diff ${F}`,
  `git -c core.hooksPath=/tmp/h commit -m x -- ${F}`,
  `cat x > >(tee ${F})`,
  `Get-Item ${F} | Select-Object @{e={Remove-Item ${F}}}`,
  `Get-Content (Remove-Item ${F})`,
  `printf x | node evil.js ${F}`,
];

function denied(command) {
  const out = execFileSync("node", [HOOK], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) }).toString();
  return out.includes('"deny"');
}
let failures = 0;
for (const c of pass) if (denied(c)) { failures++; console.log(`FAIL (denied, expected pass): ${c}`); } else console.log(`pass: ${c}`);
for (const c of deny) if (!denied(c)) { failures++; console.log(`FAIL (passed, expected deny): ${c}`); } else console.log(`deny: ${c}`);
console.log(failures ? `${failures} failure(s)` : "all cases hold");
process.exit(failures ? 1 : 0);
