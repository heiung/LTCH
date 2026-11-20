'use strict';
// Run with the local fixture server on :5182 and an installed Playwright module.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const launchChromium = require('./chromium.cjs');
const output = path.resolve('.local/practice-responsive');

(async () => {
  const browser = await launchChromium();
  const results=[];
  const errors=[];
  try {
    for (const [width,height] of [[320,740],[375,812],[430,932],[375,420],[568,320],[768,1024],[820,1180],[1024,768],[812,375],[1280,900],[1920,1080]]) {
      const page = await browser.newPage({viewport:{width,height}, reducedMotion:'reduce'});
      page.on('pageerror', error=>errors.push(error.message));
      page.on('dialog', dialog=>dialog.accept());
      await page.goto('http://127.0.0.1:5182/');
      await page.waitForFunction(()=>typeof window.qa==='function');
      for (const [type,screen] of [['thptqg','room'],['hsa','room'],['tsa','room'],['hsa','wait'],['hsa','combo'],['tsa','result'],['hsa','summary'],['tsa','lobby'],['tsa','hub']]) {
        await page.evaluate(([t,s])=>window.qa(t,s),[type,screen]);
        await page.evaluate(()=>document.fonts.ready);
        assert.ok(await page.evaluate(()=>document.fonts.check('16px Inter')),'website font is loaded');
        const metrics=await page.evaluate(()=>{
          const root=document.querySelector('.ltch-exam-fullscreen-overlay')||document.querySelector('#qa-portal');
          const rect = selector => {const e=root.querySelector(selector);return e?e.getBoundingClientRect().toJSON():null;};
          const selectors=['.ltch-compact-room-controls','.ltch-tsa-header','.ltch-hsa-9s-topbar','.ltch-result-topbar','.ltch-result-2col-layout','.ltch-thptqg-layout','.ltch-tsa-body-layout','.ltch-tsa-question-pane','.ltch-hsa-cluster-row'];
          return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
            clipped:selectors.filter(s=>{const e=root.querySelector(s);return e&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+2;}),
            question:rect('article'), passage:rect('.ltch-tsa-passage-pane'), workspace:rect('.ltch-tsa-question-pane'),
            leftResult:rect('.ltch-result-left-col'),rightResult:rect('.ltch-result-right-col'),
            tfStmt:rect('.ltch-tf-review-table td:first-child'),
            cards:root.querySelectorAll('.session-grid-card').length};
        });
        assert.equal(metrics.width,width,'test viewport must be exact');
        assert.equal(metrics.overflow,false,`${type}/${screen}/${width}: page overflow`);
        assert.deepEqual(metrics.clipped,[],`${type}/${screen}/${width}: clipped layout`);
        if(screen==='room')assert.ok(metrics.question?.width>240,`${type}/${width}: usable question width`);
        if(type==='tsa'&&screen==='room'&&width>=768&&width<=1024){
          assert.ok(metrics.passage.width>250,`TSA passage must remain readable at ${width}`);
          assert.ok(Math.abs(metrics.passage.y-metrics.workspace.y)<2,`TSA passage/questions must align at ${width}`);
          assert.ok(metrics.workspace.x>=metrics.passage.right-1,`TSA questions must sit beside passage at ${width}`);
        }
        if(screen==='lobby')assert.equal(metrics.cards,4,'all exam cards must render');
        const shouldShowNotice=width<=1024&&['hsa','tsa'].includes(type)&&['room','wait','combo','lobby'].includes(screen);
        assert.equal(await page.locator('.ltch-device-experience-notice').count(),shouldShowNotice?1:0,`${type}/${screen}/${width}: device notice scope`);
        if(screen==='result'&&width<=1024)assert.ok(metrics.leftResult.bottom<=metrics.rightResult.top,'result panels must not overlap');
        if(screen==='result')assert.ok(metrics.tfStmt&&metrics.tfStmt.width>=110,`${type}/result/${width}: true/false review statement width`);
        if([375,768,1024,1280].includes(width) && ['room','lobby','combo','result'].includes(screen))await page.screenshot({path:path.join(output,`${type}-${screen}-${width}x${height}.png`)});
        results.push({width,height,type,screen,passed:true});
      }
      await page.close();
    }

    const page=await browser.newPage({viewport:{width:375,height:812},reducedMotion:'reduce'});
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:5182/?type=thptqg');
    const first=page.locator('.ltch-option-row').first();
    await first.focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-answer-key')),'qa-q-0-option-A','answer retains keyboard focus after rendering');
    assert.equal(await page.locator('.ltch-option-row').first().getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-compact-progress]').innerText(),'1/22 câu');
    await page.locator('[data-compact-palette-toggle]').click();
    assert.equal(await page.locator('[data-compact-palette-toggle]').getAttribute('aria-expanded'),'true');
    await page.locator('[data-palette-qid="qa-q-16"]').click();
    assert.equal(await page.locator('[data-compact-palette-toggle]').getAttribute('aria-expanded'),'false');
    await page.locator('#ltch-exam-q-qa-q-16 input').fill('1,5');
    assert.equal(await page.locator('[data-compact-progress]').innerText(),'2/22 câu');
    await page.locator('.ltch-compact-submit').click();
    assert.ok(await page.locator('.ltch-modal-card').isVisible(),'submit confirmation remains reachable');
    await page.locator('.ltch-modal-backdrop').evaluate(el=>el.remove());
    await page.evaluate(()=>window.qa('tsa'));
    assert.ok(await page.locator('.ltch-device-experience-notice').isVisible());
    await page.getByRole('button',{name:'Đã hiểu gợi ý sử dụng máy tính'}).click();
    await page.getByRole('button',{name:'Ngữ liệu',exact:true}).click();
    assert.ok(await page.locator('.ltch-tsa-passage-pane').isVisible());
    assert.equal(await page.locator('.ltch-tsa-question-pane').isVisible(),false);
    await page.getByRole('button',{name:'Câu hỏi',exact:true}).click();
    await page.locator('.ltch-option-row').first().click();
    assert.equal(await page.locator('.ltch-device-experience-notice').count(),0,'answering must not redisplay a dismissed notice');
    assert.equal(await page.locator('[data-compact-progress]').innerText(),'1/50 câu');
    await page.locator('#ltch-tsa-q-qa-q-1 .ltch-option-row').nth(0).click();
    await page.locator('#ltch-tsa-q-qa-q-1 .ltch-option-row').nth(1).click();
    assert.equal(await page.locator('#ltch-tsa-q-qa-q-1 .ltch-option-row[aria-pressed="true"]').count(),2);
    for(let i=0;i<4;i++)await page.locator('#ltch-tsa-q-qa-q-2 .ltch-tsa-tf-radio.is-true').nth(i).click();
    await page.locator('#ltch-tsa-q-qa-q-3 input').fill('2,5');
    await page.locator('#ltch-tsa-q-qa-q-4 input').nth(0).fill('1');
    await page.locator('#ltch-tsa-q-qa-q-4 input').nth(1).fill('2');
    assert.equal(await page.locator('[data-compact-progress]').innerText(),'5/50 câu','all question types update progress');
    await page.locator('.ltch-compact-palette-toggle').click();
    await page.locator('[data-palette-qid="qa-q-5"]').click();
    await page.locator('#ltch-tsa-q-qa-q-5 .ltch-drag-card-pill').first().click();
    await page.locator('#ltch-tsa-q-qa-q-5 .ltch-drag-slot').first().click();
    assert.match(await page.locator('#ltch-tsa-q-qa-q-5 .ltch-drag-slot').first().innerText(),/Đồng biến/,'tap-to-place alternative works');
    await page.locator('#ltch-tsa-q-qa-q-5 .ltch-drag-card-pill').nth(1).click();
    await page.locator('#ltch-tsa-q-qa-q-5 .ltch-drag-slot').nth(1).click();
    assert.equal(await page.locator('[data-compact-progress]').innerText(),'6/50 câu');
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    assert.equal(await page.locator('.ltch-offline-banner').isVisible(),true);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    assert.equal(await page.locator('.ltch-offline-banner').isVisible(),false);
    await page.setViewportSize({width:1024,height:768});
    assert.equal(await page.locator('.ltch-option-row').first().getAttribute('aria-pressed'),'true','rotation preserves answers');
    await page.evaluate(()=>window.qa('hsa','combo'));
    await page.getByRole('button',{name:'Q03: LÍ - HÓA - ĐỊA (TỰ CHỌN)',exact:true}).click();
    await page.getByRole('button',{name:'XÁC NHẬN',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'BẮT ĐẦU',exact:true}).isVisible());
    await page.setViewportSize({width:375,height:812});
    await page.evaluate(()=>window.qa('tsa','lobby'));
    assert.equal(await page.locator('.ltch-active-room-header .ltch-room-segmented-tabs').count(),0,'active room header hides segmented room switcher');
    assert.equal(await page.locator('.ltch-room-meta-badge').count(),0,'active room header hides meta duration/score badge');
    assert.equal(await page.locator('.ltch-active-room-header select.ltch-breadcrumb-select').count(),0,'active room header hides breadcrumb room quick switcher');
    await page.getByRole('button',{name:'Đã hiểu gợi ý sử dụng máy tính'}).click();
    await page.locator('button.ltch-breadcrumb-root').click();
    await page.locator('.ltch-room-hub-card.is-hsa').click();
    assert.ok(await page.locator('.ltch-device-experience-notice').isVisible(),'switching to HSA shows a fresh notice');
    await page.locator('button.ltch-breadcrumb-root').click();
    await page.locator('.ltch-room-hub-card.is-thptqg').click();
    assert.equal(await page.locator('.ltch-device-experience-notice').count(),0,'THPTQG does not show the notice');
    await page.locator('button.ltch-breadcrumb-root').click();
    await page.locator('.ltch-room-hub-card.is-tsa').click();
    assert.ok(await page.locator('.ltch-device-experience-notice').isVisible(),'re-entering TSA shows the notice again');
    await page.getByRole('button',{name:'Làm đề',exact:true}).first().click();
    assert.ok(await page.locator('.ltch-tsa-9s-entry-modal').isVisible(),'section entry modal opens from the catalog');
    const entry=await page.locator('.ltch-tsa-9s-entry-modal').boundingBox();
    assert.ok(entry.x>=0&&entry.x+entry.width<=376&&entry.height<=812,'entry modal fits mobile');

    for (const [width,height] of [[1280,520],[375,420],[568,320],[1280,900]]) {
      await page.setViewportSize({width,height});
      for (const type of ['tsa','hsa']) {
        await page.evaluate(t=>window.qa(t,'lobby'),type);
        await page.getByRole('button',{name:'Làm đề',exact:true}).first().click();
        const modal=page.locator('.ltch-tsa-9s-entry-modal');
        const body=modal.getByRole('region',{name:'Thông tin và các phần thi'});
        const full=modal.getByRole('button',{name:/Thi cả đề 3 phần/});
        const footer=modal.getByRole('button',{name:type==='tsa'?'Về trang chủ':'Đóng',exact:true});
        const button=await full.boundingBox();
        const dismiss=await footer.boundingBox();
        assert.ok(button.height>=44&&dismiss.y+dismiss.height<=height,`${type}/${width}x${height}: both actions fit`);
        const scroll=await body.evaluate(el=>({
          content:el.scrollHeight-el.clientHeight,
          horizontal:el.scrollWidth-el.clientWidth,
          card:el.parentElement.scrollHeight-el.parentElement.clientHeight,
          backdrop:el.parentElement.parentElement.scrollHeight-el.parentElement.parentElement.clientHeight
        }));
        assert.deepEqual([scroll.horizontal,scroll.card,scroll.backdrop],[0,0,0],`${type}/${width}x${height}: one vertical scrolling surface`);
        if (height<600) {
          assert.ok(scroll.content>0,`${type}: short viewports can scroll to all parts`);
          await body.focus();
          await body.press('End');
          await page.waitForFunction(()=>document.querySelector('.ltch-practice-entry-body').scrollTop>0);
          assert.deepEqual(await full.boundingBox(),button,`${type}: actions stay visible while scrolling`);
        } else {
          assert.equal(scroll.content,0,`${type}: tall viewports show all parts directly`);
        }
        await footer.click();
        assert.equal(await modal.count(),0);
      }
    }
    await page.setViewportSize({width:320,height:740});
    for(const rType of ['thptqg','hsa','tsa']){
      await page.evaluate(t=>window.qa(t,'result'),rType);
      const stmtBox=await page.locator('.ltch-tf-review-table td:first-child').first().boundingBox();
      assert.ok(stmtBox&&stmtBox.width>=110&&stmtBox.height<220,`${rType}/result/320: readable true/false review table`);
    }
    await page.setViewportSize({width:375,height:812});
    await page.evaluate(()=>window.qa('thptqg'));
    await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'supports enlarged text');
    assert.deepEqual(errors,[],'no browser runtime errors');
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,interactions:'passed',errors},null,2));
    console.log(`PASS: ${results.length} layouts; answer, keyboard, palette, numeric input, passage tabs, tap-to-place, offline, rotation, HSA combination, entry dialogs and submit confirmation.`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
