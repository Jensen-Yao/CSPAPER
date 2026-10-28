// Run only against the isolated UI fixture after the application has closed.
const {app}=require('electron')
const path=require('node:path')
app.whenReady().then(()=>{
  const Database=require(path.join(process.cwd(),'node_modules','better-sqlite3'))
  const db=new Database(path.join(process.argv[2],'cspaper.db'))
  const workspace=db.prepare('SELECT id FROM workspaces ORDER BY created_at LIMIT 1').get()
  const now=new Date().toISOString(),id='cv_long_ui_fixture'
  db.transaction(()=>{
    db.prepare("INSERT INTO conversations(id,workspace_id,title,mode,entry,created_at,updated_at) VALUES(?,?,?,'ask','global',?,?)").run(id,workspace.id,'长会话回归 600 条',now,now)
    const insert=db.prepare("INSERT INTO chat_messages(id,conversation_id,parent_id,role,parts_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'complete',?,?)")
    let parent=null
    for(let i=0;i<600;i++){
      const messageId='long_message_'+i,role=i%2?'assistant':'user'
      const text=role==='user'?`问题 ${i/2+1}：怎样组织这几篇论文的证据？`:`## 第 ${Math.ceil(i/2)} 轮分析\n\n这是有明确研究对象的回答，用于验证长会话的阅读位置与增量开销。\n\n| 方法 | 证据 |\n| --- | --- |\n| 对照实验 | 可复现 |\n\n行内公式 $x^2+y^2=z^2$，代码里的编号应保持原样：\n\n\`\`\`js\nconst sample = '[1]';\n\`\`\`\n\n`+'研究问题、实验方法与适用边界应当分别说明。'.repeat(8)
      insert.run(messageId,id,parent,role,JSON.stringify([{type:'text',text}]),now,now)
      parent=messageId
    }
    db.prepare('UPDATE conversations SET active_leaf_id=? WHERE id=?').run(parent,id)
  })()
  db.close();console.log('LONG_CONVERSATION_SEEDED');app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})
