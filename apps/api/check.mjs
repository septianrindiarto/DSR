import("./src/db/index.js").then(async m=>{
  const a = await m.db.execute(`SELECT id,email,role,account_type,organization_id FROM "user" WHERE email='srindiarto@gmail.com'`);
  console.log("user with that email:", a.rows || a);
  const b = await m.db.execute(`SELECT id,name FROM organizations WHERE id=1`);
  console.log("org 1:", b.rows || b);
});
