/* Bundle the actual shared .gs files for the candidate entry point. No grader edits. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const agent=dirname(fileURLToPath(import.meta.url)),root=dirname(agent);
const names=['Prompts.gs','ReviewPrompt.gs','Submit.gs','Tools.gs','Describe.gs','Agent.gs','adapters/gas.gs','Entry.gs'];
const parts=names.map(name=>({name,source:readFileSync(join(agent,name),'utf8')}));
for(const {name,source} of parts)new Function(source); // syntax check each shared source
const pre='var AGENT_SURFACE='+JSON.stringify(readFileSync(join(agent,'surface.txt'),'utf8').trim())+';\n'+
 'var AGENT_DESCRIBE_SOURCE='+JSON.stringify(readFileSync(join(agent,'Describe.gs'),'utf8'))+';\n';
const body=pre+parts.map(p=>'\n/* '+p.name+' */\n'+p.source).join('\n');
new Function(body);
mkdirSync(join(root,'dist'),{recursive:true});
const target=join(root,'dist/agent-online.gs');writeFileSync(target,body);
console.log('Built '+target+' from '+names.length+' shared .gs files');
