// main.js - Firebase-backed CoinStorm app
// Assumes firebase-config.js has run and provided `auth` and `db`.

const selectors = {
    signIn: document.getElementById('btn-signin'),
    signOut: document.getElementById('btn-signout'),
    userChip: document.getElementById('user-chip'),
    coins: document.getElementById('coins'),
    btnWatch: document.getElementById('btn-watch'),
    btnInterstitial: document.getElementById('btn-interstitial'),
    activityList: document.getElementById('activity-list'),
    streakCount: document.getElementById('streak-count'),
    streakCountSide: document.getElementById('streak-count-side'),
    claimStreak: document.getElementById('btn-claim-streak'),
    streakMsg: document.getElementById('streak-msg'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    level: document.getElementById('level'),
    midAds: document.getElementById('mid-ads'),
    railAdSlots: document.getElementById('rail-ad-slots'),
    bottomAds: document.getElementById('bottom-ads'),
    stickyBanner: document.getElementById('sticky-banner'),
    nativeTop: document.getElementById('native-top-container'),
    footerYear: document.getElementById('footer-year'),
    direct1: document.getElementById('direct-1'),
    direct2: document.getElementById('direct-2'),
    direct3: document.getElementById('direct-3')
  };
  
  const DIRECT_LINKS = [
    'https://www.profitableratecpm.com/hte0hzu0v?key=fb45638729e3933cb3d3e10867a09592',
    'https://www.profitableratecpm.com/i63pbecy1?key=6ca31a0952a0956430a016a37ca0fd57',
    'https://www.profitableratecpm.com/eszwggg0?key=784e73c7dc4b992d827cc02a85d064b7'
  ];
  
  selectors.direct1.href = DIRECT_LINKS[0];
  selectors.direct2.href = DIRECT_LINKS[1];
  selectors.direct3.href = DIRECT_LINKS[2];
  
  const MAX_DAILY = 50;
  const COINS_PER_AD = 10;
  const COOLDOWN_MS = 30 * 1000; // server would also enforce in production
  const AD_PLAY_MS = 20 * 1000; // UI simulated watch time
  
  selectors.footerYear.textContent = new Date().getFullYear();
  let currentUser = null;
  
  // helper: show activity entry
  function pushActivity(text) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.marginBottom = '8px';
    el.innerHTML = `<div style="font-weight:700">${text}</div><div class="muted">${new Date().toLocaleString()}</div>`;
    if (selectors.activityList.firstChild) selectors.activityList.insertBefore(el, selectors.activityList.firstChild);
    else selectors.activityList.appendChild(el);
  }
  
  // helper: play coin sound & confetti
  function celebrate() {
    try { document.getElementById('coin-sound').play().catch(()=>{}); } catch(e){}
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
  }
  
  // calculate level and update UI
  function updateLevelUI(coins) {
    const levelNum = Math.floor(coins / 100) + 1;
    const progress = coins % 100;
    selectors.level.textContent = levelNum;
    selectors.progressFill.style.width = Math.min(progress,100) + '%';
    selectors.progressText.textContent = `${progress} / 100`;
    // level-up confetti: store lastLevel locally
    const lastLevel = parseInt(localStorage.getItem('cs_lastLevel') || '1');
    if (levelNum > lastLevel) {
      localStorage.setItem('cs_lastLevel', levelNum);
      confetti({ particleCount: 140, spread: 100, origin: { y: 0.35 }});
    }
  }
  
  // load user doc from Firestore or create
  async function loadUserDoc(uid) {
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        coins: 0,
        dailyCount: 0,
        lastAdTime: 0,
        streakCount: 0,
        lastClaimDate: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { coins:0, dailyCount:0, lastAdTime:0, streakCount:0, lastClaimDate:null };
    }
    return snap.data();
  }
  
  // update user UI from doc
  function applyUserUI(docData, displayName) {
    selectors.coins.textContent = docData.coins || 0;
    selectors.streakCount.textContent = docData.streakCount || 0;
    selectors.streakCountSide.textContent = docData.streakCount || 0;
    updateLevelUI(docData.coins || 0);
    selectors.userChip.textContent = displayName || 'You';
  }
  
  // atomic ad reward (transaction)
  async function rewardAd(uid) {
    const ref = db.collection('users').doc(uid);
    try {
      const result = await db.runTransaction(async tx => {
        const doc = await tx.get(ref);
        if (!doc.exists) throw 'User doc missing';
        const data = doc.data();
        const now = Date.now();
        if ((now - (data.lastAdTime || 0)) < COOLDOWN_MS) {
          throw { code: 'COOLDOWN', wait: Math.ceil((COOLDOWN_MS - (now - data.lastAdTime))/1000) };
        }
        if ((data.dailyCount || 0) >= MAX_DAILY) throw { code: 'DAILY_LIMIT' };
        const newDaily = (data.dailyCount || 0) + 1;
        const newCoins = (data.coins || 0) + COINS_PER_AD;
        tx.update(ref, {
          coins: newCoins,
          dailyCount: newDaily,
          lastAdTime: now
        });
        // daily bonus awarding (server would be better)
        let bonus = 0;
        if (newDaily === 10) bonus = 20;
        if (newDaily === 25) bonus = 50;
        if (newDaily === 50) bonus = 100;
        if (bonus > 0) tx.update(ref, { coins: newCoins + bonus });
        return { coins: newCoins + bonus, dailyCount: newDaily, bonus };
      });
      return result;
    } catch (e) {
      throw e;
    }
  }
  
  // add coins for direct offer click (simple increment)
  async function addCoinsForOffer(uid, amount, reason='Offer') {
    const ref = db.collection('users').doc(uid);
    await ref.update({ coins: firebase.firestore.FieldValue.increment(amount) });
    const doc = await ref.get();
    const data = doc.data();
    applyUserUI(data, currentUser.displayName);
    pushActivity(`+${amount} coins via ${reason}`);
    celebrate();
  }
  
  // claim daily streak bonus
  async function claimDailyBonus(uid) {
    const ref = db.collection('users').doc(uid);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw 'User missing';
      const data = snap.data();
      const today = new Date().toDateString();
      const lastClaim = data.lastClaimDate ? new Date(data.lastClaimDate.toDate()).toDateString() : null;
      let streak = data.streakCount || 0;
      let bonus = 10;
      if (lastClaim === today) throw { code:'ALREADY_CLAIMED' };
      if (lastClaim && (new Date(lastClaim).getTime() === new Date(today).getTime() - 86400000)) {
        // consecutive
        streak = (streak || 0) + 1;
      } else {
        streak = 1;
      }
      if (streak === 1) bonus = 10;
      else if (streak === 2) bonus = 20;
      else bonus = 30;
      tx.update(ref, {
        coins: firebase.firestore.FieldValue.increment(bonus),
        streakCount: streak,
        lastClaimDate: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    // refresh UI
    const doc = await db.collection('users').doc(uid).get();
    applyUserUI(doc.data(), currentUser.displayName);
    pushActivity(`Claimed daily bonus`);
    celebrate();
  }
  
  // redeem reward
  async function redeemReward(uid, rewardId, cost, name) {
    const ref = db.collection('users').doc(uid);
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw 'User missing';
        const coins = snap.data().coins || 0;
        if (coins < cost) throw { code:'NOT_ENOUGH' };
        tx.update(ref, { coins: coins - cost });
        const code = `${rewardId.toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
        tx.set(db.collection('redemptions').doc(), {
          uid: uid,
          rewardId,
          rewardName: name,
          cost,
          code,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return code;
      }).then((code) => {
        // transaction returned code is not available via then; create code separately
        // simpler: generate code and add entry
        const code = `${rewardId.toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
        db.collection('redemptions').add({
          uid, rewardId, rewardName: name, cost, code, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        pushActivity(`Redeemed ${name} • Code: ${code}`);
        alert(`Redeemed ${name}\nCode: ${code}`);
        celebrate();
      }).catch(e => { throw e;});
    } catch (e) {
      if (e && e.code === 'NOT_ENOUGH') alert('Not enough coins');
      else alert('Redeem error');
      throw e;
    }
  }
  
  // UI wiring
  selectors.signIn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => alert('Sign in failed: ' + err.message));
  });
  selectors.signOut.addEventListener('click', () => auth.signOut());
  
  selectors.btnWatch.addEventListener('click', async () => {
    if (!currentUser) { alert('Sign in first'); return; }
  
    // ensure popunder only triggers on click (browser friendly)
    // open a direct link (popunder) then run reward flow
    const popup = window.open(DIRECT_LINKS[Math.floor(Math.random()*DIRECT_LINKS.length)], '_blank');
    if (!popup) {
      alert('Please allow popups for offers');
      return;
    }
  
    // show UI 20s countdown
    let left = AD_PLAY_MS / 1000;
    selectors.btnWatch.disabled = true;
    const timerEl = selectors.btnWatch;
    const initialText = timerEl.textContent;
    timerEl.textContent = `Ad playing... ${left}s`;
    const t = setInterval(() => {
      left--;
      timerEl.textContent = `Ad playing... ${left}s`;
      if (left <= 0) {
        clearInterval(t);
        timerEl.textContent = initialText;
        selectors.btnWatch.disabled = false;
      }
    }, 1000);
  
    // while UI runs, we update Firestore when finished
    setTimeout(async () => {
      try {
        const res = await rewardAd(currentUser.uid);
        // res has coins, dailyCount, bonus
        const snap = await db.collection('users').doc(currentUser.uid).get();
        applyUserUI(snap.data(), currentUser.displayName);
        pushActivity(`+${COINS_PER_AD} coins (ad)`);
        if (res.bonus) {
          pushActivity(`Daily bonus +${res.bonus}`);
          showToast(`Daily bonus +${res.bonus}!`);
        }
        celebrate();
      } catch (err) {
        if (err && err.code === 'COOLDOWN') {
          alert(`Please wait ${err.wait}s`);
        } else if (err && err.code === 'DAILY_LIMIT') {
          alert('Daily limit reached');
        } else {
          console.error(err);
          alert('Ad reward failed');
        }
      }
    }, AD_PLAY_MS + 500);
  });
  
  selectors.btnInterstitial.addEventListener('click', () => {
    if (!currentUser) { alert('Sign in first'); return; }
    const link = DIRECT_LINKS[Math.floor(Math.random()*DIRECT_LINKS.length)];
    window.open(link, '_blank');
    addCoinsForOffer(currentUser.uid, 5, 'Interstitial');
  });
  
  // claim streak
  selectors.claimStreak.addEventListener('click', async () => {
    if (!currentUser) { alert('Sign in first'); return; }
    try {
      await claimDailyBonus(currentUser.uid);
      selectors.streakMsg.textContent = 'Bonus claimed. Good job!';
    } catch (e) {
      if (e && e.code === 'ALREADY_CLAIMED') selectors.streakMsg.textContent = 'Already claimed today';
      else selectors.streakMsg.textContent = 'Error claiming streak';
    }
  });
  
  // redeem buttons
  document.querySelectorAll('.redeem-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      if (!currentUser) { alert('Sign in first'); return; }
      const parent = ev.target.closest('.reward');
      const rewardId = parent.getAttribute('data-id');
      const cost = parseInt(parent.getAttribute('data-cost'));
      const name = parent.getAttribute('data-name') || parent.querySelector('.reward-title')?.textContent || rewardId;
      try {
        // create code and track redemption
        const docRef = db.collection('redemptions').doc();
        const userRef = db.collection('users').doc(currentUser.uid);
        await db.runTransaction(async tx => {
          const userSnap = await tx.get(userRef);
          const coins = (userSnap.data().coins || 0);
          if (coins < cost) throw { code: 'NOT_ENOUGH' };
          tx.update(userRef, { coins: coins - cost });
          const code = `${rewardId.toUpperCase()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
          tx.set(docRef, { uid: currentUser.uid, rewardId, rewardName: name, cost, code, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
          // return code not available here; set after transaction
        });
        // fetch latest coins & display code by querying the latest redemption for user + rewardId
        const redSnap = await db.collection('redemptions').where('uid','==',currentUser.uid).where('rewardId','==',rewardId).orderBy('createdAt','desc').limit(1).get();
        if (!redSnap.empty) {
          const rd = redSnap.docs[0].data();
          parent.querySelector('.reward-code').style.display = 'block';
          parent.querySelector('.reward-code').textContent = `Code: ${rd.code}`;
          pushActivity(`Redeemed ${name} • ${rd.code}`);
          alert(`Redeemed ${name}\nCode: ${rd.code}`);
          const userSnap = await db.collection('users').doc(currentUser.uid).get();
          applyUserUI(userSnap.data(), currentUser.displayName);
        } else {
          alert('Redeem completed');
        }
      } catch (e) {
        if (e && e.code === 'NOT_ENOUGH') alert('Not enough coins');
        else { console.error(e); alert('Redeem failed'); }
      }
    });
  });
  
  // auth state handling
  auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      selectors.signIn.style.display = 'none';
      selectors.signOut.style.display = 'inline-block';
      selectors.userChip.textContent = user.displayName || user.email;
      // load & listen to user doc
      const ref = db.collection('users').doc(user.uid);
      // create if not present
      const doc = await ref.get();
      if (!doc.exists) {
        await ref.set({
          coins: 0,
          dailyCount: 0,
          lastAdTime: 0,
          streakCount: 0,
          lastClaimDate: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      // realtime listener to update UI when coins change
      ref.onSnapshot(snap => {
        const data = snap.data();
        if (!data) return;
        selectors.coins.textContent = data.coins || 0;
        selectors.streakCount.textContent = data.streakCount || 0;
        selectors.streakCountSide.textContent = data.streakCount || 0;
        updateLevelUI(data.coins || 0);
      });
      // initial load
      const data = (await ref.get()).data();
      selectors.coins.textContent = data.coins || 0;
      selectors.streakCount.textContent = data.streakCount || 0;
      updateLevelUI(data.coins || 0);
      pushActivity('Welcome back!');
    } else {
      currentUser = null;
      selectors.signIn.style.display = 'inline-block';
      selectors.signOut.style.display = 'none';
      selectors.userChip.textContent = 'Not signed in';
      selectors.coins.textContent = '0';
    }
  });
  
  // Ads injection (only on real host)
  function injectAdsIfLive() {
    if (location.hostname === 'localhost' || location.hostname === '' ) {
      console.log('Localhost — skipping live ad injection');
      return;
    }
  
    // Native top: many networks expect a single container id; use the script you provided (top)
    // Keep the top container; the script should render into the container id it's configured for.
    const topScript = document.createElement('script');
    topScript.async = true;
    topScript.setAttribute('data-cfasync','false');
    topScript.src = '//pl27363242.profitableratecpm.com/321b2d611b0c8db166ec76303f1333a3/invoke.js';
    selectors.nativeTop.appendChild(topScript);
  
    // Repeated 320x50 banners (safe to repeat)
    function create320() {
      const wrapper = document.createElement('div');
      wrapper.className = 'ad card';
      wrapper.innerHTML = `<div class="ad-label">Sponsored • 320×50</div>`;
      const inline = document.createElement('div');
      // atOptions script + invoke
      inline.innerHTML = `<script>window.atOptions = {'key':'1f337db27a0d5b62ae02902a6ad75bd1','format':'iframe','height':50,'width':320,'params':{}};<\/script>
        <script async src="//www.highperformanceformat.com/1f337db27a0d5b62ae02902a6ad75bd1/invoke.js"><\/script>`;
      wrapper.appendChild(inline);
      return wrapper;
    }
  
    // insert a few in mid-ads
    for (let i=0;i<4;i++) selectors.midAds.appendChild(create320());
    // rail ad slots
    for (let i=0;i<3;i++) selectors.railAdSlots.appendChild(create320());
    // bottom ads cluster
    for (let i=0;i<3;i++) selectors.bottomAds.appendChild(create320());
    // sticky banner (center)
    selectors.stickyBanner.innerHTML = `<div class="card" style="padding:6px"><div class="ad-label">Sponsored • Sticky 320×50</div>
      <script>window.atOptions={'key':'1f337db27a0d5b62ae02902a6ad75bd1','format':'iframe','height':50,'width':320,'params':{}};<\/script>
      <script async src="//www.highperformanceformat.com/1f337db27a0d5b62ae02902a6ad75bd1/invoke.js"><\/script></div>`;
  }
  
  // small toast
  function showToast(msg) {
    pushActivity(msg);
  }
  
  // initialize
  injectAdsIfLive();
  