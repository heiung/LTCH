'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const launchChromium=require('./chromium.cjs');
const output=path.resolve('.local/practice-responsive/touch');

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await launchChromium();
  const devices=[
    {name:'iphone',width:390,height:844,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'},
    {name:'android-landscape',width:915,height:412,ua:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'},
    {name:'ipad-portrait',width:768,height:1024,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'},
    {name:'ipad-landscape',width:1366,height:1024,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'}
  ];
  let tested=0;
  try{
    for(const device of devices)for(const type of ['thptqg','hsa','tsa']){
      const context=await browser.newContext({viewport:{width:device.width,height:device.height},userAgent:device.ua,isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      if(device.name.startsWith('ipad'))await page.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'}));
      await page.goto(`http://127.0.0.1:5182/?type=${type}`);
      await page.locator('article').first().waitFor();
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('.ltch-device-experience-notice').count(),type==='thptqg'?0:1,`${device.name}/${type}: notice`);
      if(type!=='thptqg')await page.getByRole('button',{name:'Đã hiểu gợi ý sử dụng máy tính'}).tap();
      const smallTargets=await page.evaluate(()=>[...document.querySelectorAll('#ltch-practice-fullscreen-root button')].filter(el=>{
        const r=el.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&(r.width<43.5||r.height<43.5);
      }).map(el=>({text:el.textContent.trim().slice(0,40),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
      assert.deepEqual(smallTargets,[],`${device.name}/${type}: touch targets`);
      await page.locator('.ltch-option-row').first().tap();
      assert.equal(await page.locator('.ltch-option-row').first().getAttribute('aria-pressed'),'true','touch answer is retained');
      if(type!=='hsa'){
        await page.locator('[data-compact-palette-toggle]').tap();
        await page.locator('[data-palette-qid="qa-q-2"]').tap();
      }else await page.locator('#ltch-exam-q-qa-q-2').scrollIntoViewIfNeeded();
      const tf=page.locator(type==='thptqg'?'#ltch-exam-q-qa-q-12 .ltch-tf-interactive-table':type==='hsa'?'#ltch-exam-q-qa-q-2 .ltch-tf-interactive-table':'#ltch-tsa-q-qa-q-2 .ltch-tf-interactive-table');
      await tf.scrollIntoViewIfNeeded();
      const table=await tf.boundingBox();
      const card=await tf.locator('xpath=ancestor::article').boundingBox();
      assert.ok(table.x>=card.x-1&&table.x+table.width<=card.x+card.width+1,`${device.name}/${type}: true/false table must fit its question`);
      const overlappingChoices=await tf.evaluate(el=>[...el.querySelectorAll('tr')].some(row=>{
        const buttons=[...row.querySelectorAll('button')];
        return buttons.length===2&&buttons[0].getBoundingClientRect().right+7>buttons[1].getBoundingClientRect().left;
      }));
      assert.equal(overlappingChoices,false,'true/false controls must have separate touch targets');
      await page.screenshot({path:path.join(output,`${device.name}-${type}.png`),animations:'disabled'});
      if(type==='tsa'){
        await page.locator('.ltch-compact-submit').tap();
        assert.ok(await page.locator('.ltch-modal-card').isVisible());
        await page.getByRole('button',{name:'Làm bài tiếp',exact:true}).tap();
        assert.equal(await page.locator('.ltch-modal-card').count(),0);
      }
      assert.deepEqual(errors,[]);
      tested++;
      await context.close();
    }
    for(const width of [320,375,768])for(const type of ['thptqg','hsa','tsa']){
      const page=await browser.newPage({viewport:{width,height:900},hasTouch:true,isMobile:true});
      await page.goto(`http://127.0.0.1:5182/?type=${type}&stress=1`);
      await page.evaluate(()=>document.fonts.ready);
      if(type!=='thptqg')await page.getByRole('button',{name:'Đã hiểu gợi ý sử dụng máy tính'}).tap();
      await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode().catch(()=>{}))));
      const metrics=await page.locator('article').first().evaluate(card=>{
        const prompt=card.querySelector('.ltch-q-prompt'), image=card.querySelector('img');
        return {promptWidth:prompt.clientWidth,promptScroll:prompt.scrollWidth,card:card.getBoundingClientRect().toJSON(),image:image?.getBoundingClientRect().toJSON()};
      });
      const table=page.locator('article').first().locator('.ltch-table-scroll');
      await page.locator('article').first().getByText('Cuộn ngang để xem đủ các cột', {exact:false}).waitFor();
      assert.equal(await table.getAttribute('tabindex'), '0');
      await table.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('article .ltch-table-scroll').scrollLeft > 0);
      await page.screenshot({path:path.join(output,`stress-${type}-${width}.png`)});
      assert.ok(metrics.promptScroll<=metrics.promptWidth+2,`${type}/${width}: long formulas and tables must stay inside the prompt`);
      assert.ok(metrics.image&&metrics.image.width<=metrics.card.width&&metrics.image.x>=metrics.card.x&&metrics.image.right<=metrics.card.right,`${type}/${width}: large illustration must fit the question`);
      tested++;
      await page.close();
    }
    console.log(`PASS: ${tested} touch-device flows, including 1366px iPad landscape, notice scope, answer taps, target sizes, true/false tables and submit cancellation.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
