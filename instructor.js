// DrivePro instructor workflow code.
// ============================================================
      // NAVIGATION
      // ============================================================
      function showPage(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navMap = {
          'page-attendance': 'nav-attendance',
          'page-class-schedule': 'nav-class-schedule',
          'page-student-attendance': 'nav-student-attendance',
          'page-petrol': 'nav-petrol'
        };
        const navEl = document.getElementById(navMap[id]);
        if (navEl) navEl.classList.add('active');
        // Auto-render student attendance page with instructor's students
        if (id === 'page-student-attendance') initStudentAttendancePage();
        if (id === 'page-attendance') renderSelfAttHistory();
      }

      function getCurrentInstructorName() {
        if (!currentUser || !currentUser.email) return (currentUser && currentUser.displayName) ? currentUser.displayName : '';
        const email = (currentUser.email || '').toString();
        const display = (currentUser.displayName || '').toString();
        const username = email.split('@')[0] || '';
        if (typeof data !== 'undefined' && data) {
          const instructors = (data.staff || []).filter(st => st.role === 'instructor');
          const adminInst = (data.admins || []).filter(a => a.role === 'instructor');
          const allInst = instructors.concat(adminInst);
          // Try matching by email first (exact), then by display name, then by username (local-part),
          // then as a last resort check if the email contains the staff.name.
          let matched = allInst.find(inst => inst.email && inst.email.toLowerCase() === email.toLowerCase());
          if (!matched && display) matched = allInst.find(inst => inst.name && inst.name.toLowerCase() === display.toLowerCase());
          if (!matched && username) matched = allInst.find(inst => inst.name && inst.name.toLowerCase() === username.toLowerCase());
          if (!matched) matched = allInst.find(inst => inst.name && email.toLowerCase().includes(inst.name.toLowerCase()));
          if (matched) return matched.name || (display || username);
        }
        // Fallback to displayName or username so other filters can match schedule/instructor fields
        return display || username;
      }

      function initStudentAttendancePage() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const displayDate = today.toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
        const displayEl = document.getElementById('student-att-date-display');
        if (displayEl) displayEl.textContent = 'Marking for ' + displayDate;

        // Get instructor's students (scoped to current school and instructor)
        const instructorName = getCurrentInstructorName();
        const myStudents = (typeof data !== 'undefined' ? data.students || [] : []).filter(s =>
          (!currentSchoolId || s.schoolId === currentSchoolId) &&
          s.status !== 'Completed' &&
          (s.instructorEmail === (currentUser ? currentUser.email : '') ||
           s.instructor === (currentUser ? currentUser.email : '') ||
           s.instructor === instructorName)
        );

        const badge = document.getElementById('student-att-count-badge');
        if (badge) badge.textContent = myStudents.length + ' Students';

        const grid = document.getElementById('student-att-grid');
        if (!grid) return;

        if (myStudents.length === 0) {
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2);"><div style="font-size:32px;margin-bottom:10px;">👥</div><div>No active students assigned to you yet.</div></div>';
          updateAttCounts();
          return;
        }

        // Check which students already have attendance saved today
        const existingAtt = {};
        if (typeof db !== 'undefined' && currentSchoolId) {
          Promise.all(myStudents.map(s => {
            const fid = s.firebaseId || s.id;
            return db.collection('schools').doc(currentSchoolId).collection('studentAttendance')
              .doc(dateStr + '_' + fid).get()
              .then(doc => { if (doc.exists) existingAtt[fid] = doc.data().status; })
              .catch(()=>{});
          })).then(() => {
            buildAttGrid(myStudents, existingAtt, grid);
          });
        } else {
          buildAttGrid(myStudents, {}, grid);
        }
        updateAttCounts();
      }

      function buildAttGrid(students, existingAtt, grid) {
        grid.innerHTML = students.map(s => {
          const fid = s.firebaseId || s.id;
          const initStatus = existingAtt[fid] || '';
          const cfg = { '':{ cls:'', label:'— Not Marked', color:'var(--text3)', check:'' },
            'present':{ cls:'present', label:'✅ Present', color:'var(--success)', check:'✅' },
            'late':   { cls:'late',    label:'⏰ Late',    color:'var(--warning)', check:'⏰' },
            'absent': { cls:'absent',  label:'❌ Absent',  color:'var(--danger)',  check:'❌' } }[initStatus] ||
            { cls:'', label:'— Not Marked', color:'var(--text3)', check:'' };
          const initials = s.name.split(' ').map(x=>x[0]).join('').toUpperCase();
          return '<div class="att-card ' + cfg.cls + '" data-student="' + s.name + '" data-student-id="' + fid + '" data-status="' + initStatus + '" onclick="cycleStudentAtt(this, \'' + s.name.replace(/'/g,"\\'") + '\')">' +
            '<div style="font-size:28px;margin-bottom:8px;font-weight:700;color:var(--primary);">' + initials + '</div>' +
            '<div id="att-check-' + s.name.replace(/\s/g,'_') + '" style="font-size:22px;height:28px;">' + cfg.check + '</div>' +
            '<div style="font-weight:600;font-size:14px;margin-bottom:4px;">' + s.name + '</div>' +
            '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">' + (s.vehicle||'Vehicle') + '</div>' +
            '<div id="att-status-' + s.name.replace(/\s/g,'_') + '" style="font-size:12px;font-weight:500;color:' + cfg.color + ';">' + cfg.label + '</div>' +
          '</div>';
        }).join('');
        updateAttCounts();
      }

      // ============================================================
      // SELF ATTENDANCE
      // ============================================================
      let selfMarked = false;

      function openSelfAttModal() {
        if (selfMarked) { showToast('✅ Attendance already marked for today!'); return; }
        const now = new Date();
        const hh = String(now.getHours()).padStart(2,'0');
        const mm = String(now.getMinutes()).padStart(2,'0');
        document.getElementById('self-att-check-in').value = `${hh}:${mm}`;
        openModal('modal-self-att');
      }

      async function markSelfPresent() {
        const status = document.getElementById('self-att-status').value;
        const time = document.getElementById('self-att-check-in').value;
        const location = document.getElementById('self-att-location').value || 'School';
        const note = document.getElementById('self-att-note') ? document.getElementById('self-att-note').value : '';
        const today = new Date().toISOString().split('T')[0];

        // Enforce school location proximity for attendance
        if (typeof checkLocationForSelfAttendance === 'function') {
          const withinRadius = await checkLocationForSelfAttendance();
          if (!withinRadius) {
            alert('Attendance can only be marked within 100 meters of your school location.');
            return;
          }
        }

        selfMarked = true;

        // Update banner UI
        const banner = document.getElementById('self-att-banner');
        banner.style.background = 'linear-gradient(135deg, #15803d, #16a34a)';
        document.getElementById('self-att-msg').textContent = status === 'late' ? '⏰ Marked — Late' : '✅ Attendance Marked — Present';
        document.getElementById('self-att-sub').textContent = 'Checked in at ' + time + ' · ' + location;
        const timeBlock = document.getElementById('self-att-time-block');
        timeBlock.style.display = 'block';
        document.getElementById('self-att-time').textContent = time;

        const btn = document.getElementById('mark-self-btn');
        btn.textContent = '✅ Marked'; btn.disabled = true; btn.style.opacity = '0.7';
        document.getElementById('next-steps-card').style.display = 'block';

        // Save to Firebase
        const attEntry = {
          date: today,
          time,
          status,
          location,
          note,
          type: 'Instructor',
          userName: currentUser ? (currentUser.displayName || currentUser.email) : 'Unknown',
          userEmail: currentUser ? currentUser.email : '',
          userId: currentUser ? currentUser.uid : '',
          schoolId: currentSchoolId || ''
        };

        try {
          const userKey = (typeof getAttendanceUserKey === 'function') ? getAttendanceUserKey(currentUser) : (currentUser ? (currentUser.displayName || currentUser.email || currentUser.uid) : 'Unknown');
          if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.updateAttendanceByType === 'function') {
            try {
              const collectionName = (currentRole === 'office' || currentRole === 'admin') ? 'adminAttendance' : 'instructorAttendance';
              await FirebaseService.updateAttendanceByType(today, userKey, attEntry, collectionName);
            } catch (err) {
              console.warn('FirebaseService.updateAttendanceByType failed:', err.message);
              if (typeof db !== 'undefined' && currentSchoolId) {
                await db.collection('schools').doc(currentSchoolId).collection('attendance')
                  .doc(today + '_instructor_' + (currentUser ? currentUser.uid : 'unknown'))
                  .set(attEntry);
              }
            }
          } else {
            if (typeof db !== 'undefined' && currentSchoolId) {
              await db.collection('schools').doc(currentSchoolId).collection('attendance')
                .doc(today + '_instructor_' + (currentUser ? currentUser.uid : 'unknown'))
                .set(attEntry);
            }
          }

          // Update local attendance history
          await renderSelfAttHistory();

          // If current user is an admin or instructor, open schedule page after self-attendance
          if (currentRole === 'office' || currentRole === 'admin' || currentRole === 'instructor') {
            try {
              navigateTo && typeof navigateTo === 'function' ? navigateTo('class-schedule') : openModal('modal-bulk-schedule');
              if (typeof renderSchedule === 'function') renderSchedule();
            } catch(e) { console.warn('Could not open schedule view:', e.message); }
          }
        } catch(e) {
          console.warn('Could not save attendance to Firebase:', e.message);
        }

        closeModal('modal-self-att');
        showToast('✅ Attendance marked successfully!');
      }

      async function renderSelfAttHistory() {
        const tbody = document.getElementById('att-history-body');
        if (!tbody) return;
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = today.slice(0,7);
        try {
          let records = [];
          let todayEntry = null;
          // Try role-specific attendance collection first
          if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.getAttendanceByType === 'function' && currentUser) {
            const userKey = (typeof getAttendanceUserKey === 'function') ? getAttendanceUserKey(currentUser) : (currentUser ? (currentUser.displayName || currentUser.email || currentUser.uid) : 'Unknown');
            const collectionName = (currentRole === 'office' || currentRole === 'admin') ? 'adminAttendance' : 'instructorAttendance';
            for (let i = 0; i < 30; i++) {
              const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
              try {
                const doc = await FirebaseService.getAttendanceByType(date, collectionName);
                if (doc && doc[userKey]) {
                  const entry = { ...doc[userKey], date };
                  records.push(entry);
                  if (date === today) todayEntry = entry;
                }
              } catch(e) { /* ignore individual date failures */ }
            }
          } else if (typeof db !== 'undefined' && currentSchoolId && currentUser) {
            const snap = await db.collection('schools').doc(currentSchoolId).collection('attendance')
              .where('userEmail','==', currentUser.email)
              .where('date','>=', thisMonth + '-01')
              .orderBy('date','desc').limit(30).get();
            records = snap.docs.map(d => d.data());
          }
          let present=0, absent=0, late=0;
          records.forEach(r => {
            if(r.status==='present') present++;
            else if(r.status==='absent') absent++;
            else if(r.status==='late') late++;
          });
          const total = records.length;
          const rate = total > 0 ? Math.round(((present+late)/total)*100) : 0;
          const onTime = present;
          ['stat-days-present','stat-days-absent','stat-att-rate','stat-on-time'].forEach((id,i) => {
            const el = document.getElementById(id);
            if(el) el.textContent = [present, absent, rate+'%', onTime][i];
          });
          if (todayEntry) {
            selfMarked = true;
            const banner = document.getElementById('self-att-banner');
            if (banner) banner.style.background = 'linear-gradient(135deg, #15803d, #16a34a)';
            const msg = document.getElementById('self-att-msg');
            const sub = document.getElementById('self-att-sub');
            const timeBlock = document.getElementById('self-att-time-block');
            const timeEl = document.getElementById('self-att-time');
            const btn = document.getElementById('mark-self-btn');
            if (msg) msg.textContent = todayEntry.status === 'late' ? '⏰ Marked — Late' : '✅ Attendance Marked — Present';
            if (sub) sub.textContent = 'Checked in at ' + (todayEntry.time || '—') + ' · ' + (todayEntry.location || 'School');
            if (timeBlock) timeBlock.style.display = 'block';
            if (timeEl) timeEl.textContent = todayEntry.time || '—';
            if (btn) { btn.textContent = '✅ Marked'; btn.disabled = true; btn.style.opacity = '0.7'; }
            const nextCard = document.getElementById('next-steps-card');
            if (nextCard) nextCard.style.display = 'block';
          }
          if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2);">No attendance records yet.</td></tr>';
            return;
          }
          tbody.innerHTML = records.map(r => {
            const cls = r.status==='present'?'badge-green':r.status==='late'?'badge-amber':'badge-red';
            return '<tr><td>'+r.date+'</td><td>'+r.time+'</td><td><span class="badge '+cls+'">'+r.status+'</span></td><td>'+r.location+'</td><td>'+(r.note||'—')+'</td></tr>';
          }).join('');
        } catch(e) {
          console.warn('Could not load attendance history:', e.message);
        }
      }

      function completeStep(stepNum) {
        for (let i = 1; i < stepNum; i++) {
          const el = document.getElementById('step'+i);
          if (el) { el.className = 'step-circle done'; el.textContent = '✓'; }
          const conn = document.getElementById('conn'+i);
          if (conn) conn.className = 'step-connector done';
        }
        const current = document.getElementById('step'+stepNum);
        if (current) current.className = 'step-circle active';
      }

      // ============================================================
      // STUDENT ATTENDANCE
      // ============================================================
      const attCycle = ['', 'present', 'late', 'absent'];
      const attConfig = {
        '': { cls: '', label: '— Not Marked', color: 'var(--text3)', check: '' },
        'present': { cls: 'present', label: '✅ Present', color: 'var(--success)', check: '✅' },
        'late':    { cls: 'late',    label: '⏰ Late',    color: 'var(--warning)', check: '⏰' },
        'absent':  { cls: 'absent',  label: '❌ Absent',  color: 'var(--danger)', check: '❌' },
      };

      function cycleStudentAtt(card, studentName) {
        const curr = card.dataset.status || '';
        const nextIdx = (attCycle.indexOf(curr) + 1) % attCycle.length;
        const next = attCycle[nextIdx];

        // If marking absent, prompt for reason immediately
        if (next === 'absent') {
          const reason = prompt(`Reason for ${studentName}'s absence:`);
          if (reason && reason.trim()) {
            card.dataset.absentReason = reason.trim();
          } else {
            // If they cancel or leave blank, skip absent (go to next status)
            const skipIdx = (nextIdx + 1) % attCycle.length;
            const skipNext = attCycle[skipIdx];
            card.dataset.status = skipNext;
            card.dataset.absentReason = '';
            const skipCfg = attConfig[skipNext];
            card.className = 'att-card ' + skipCfg.cls;
            const safeKey = studentName.replace(/\s/g,'_');
            const statusEl = document.getElementById('att-status-' + safeKey);
            const checkEl  = document.getElementById('att-check-'  + safeKey);
            if (statusEl) { statusEl.textContent = skipCfg.label; statusEl.style.color = skipCfg.color; }
            if (checkEl)  { checkEl.textContent  = skipCfg.check; }
            updateAttCounts();
            return;
          }
        } else {
          card.dataset.absentReason = '';
        }

        card.dataset.status = next;
        const cfg = attConfig[next];
        card.className = 'att-card ' + cfg.cls;
        const safeKey = studentName.replace(/\s/g,'_');
        const statusEl = document.getElementById('att-status-' + safeKey);
        const checkEl  = document.getElementById('att-check-'  + safeKey);
        if (statusEl) { statusEl.textContent = cfg.label; statusEl.style.color = cfg.color; }
        if (checkEl)  { checkEl.textContent  = cfg.check; }
        // Show absent reason on card if absent
        const reasonEl = card.querySelector('.absent-reason-label');
        if (next === 'absent' && card.dataset.absentReason) {
          if (!reasonEl) {
            const rEl = document.createElement('div');
            rEl.className = 'absent-reason-label';
            rEl.style.cssText = 'font-size:10px;color:var(--danger);margin-top:3px;word-break:break-word;';
            rEl.textContent = '📝 ' + card.dataset.absentReason;
            card.appendChild(rEl);
          } else {
            reasonEl.textContent = '📝 ' + card.dataset.absentReason;
          }
        } else if (reasonEl) {
          reasonEl.remove();
        }
        updateAttCounts();
      }

      function updateAttCounts() {
        const cards = document.querySelectorAll('.att-card[data-student]');
        let p=0, ab=0, l=0, nd=0;
        cards.forEach(c => {
          const s = c.dataset.status;
          if(s==='present') p++;
          else if(s==='absent') ab++;
          else if(s==='late') l++;
          else nd++;
        });
        document.getElementById('att-present-count').textContent = p;
        document.getElementById('att-absent-count').textContent = ab;
        document.getElementById('att-late-count').textContent = l;
        document.getElementById('att-pending-count').textContent = nd;
      }

      async function saveStudentAttendance() {
        const cards = document.querySelectorAll('.att-card[data-student]');
        let hasUnmarked = false;
        cards.forEach(c => { if (!c.dataset.status) hasUnmarked = true; });
        if (hasUnmarked && !confirm('Some students are not marked. Save anyway?')) return;

        // Check all absent students have a reason
        const absentCards = Array.from(cards).filter(c => c.dataset.status === 'absent');
        for (const card of absentCards) {
          const studentName = card.dataset.student;
          const reason = card.dataset.absentReason || '';
          if (!reason) {
            const enteredReason = prompt(`Reason for ${studentName}'s absence (required):`);
            if (!enteredReason || !enteredReason.trim()) {
              showToast('⚠ Please provide an absent reason for ' + studentName);
              return;
            }
            card.dataset.absentReason = enteredReason.trim();
          }
        }

        const btn = document.getElementById('save-att-btn');
        if (btn) { btn.disabled = true; btn.textContent = '💾 Saving…'; }

        const today = new Date().toISOString().split('T')[0];
        const records = [];
        const updatedStudents = [];

        cards.forEach(card => {
          const studentName = card.dataset.student;
          const studentId   = card.dataset.studentId;
          const status      = card.dataset.status || 'absent';
          const absentReason = card.dataset.absentReason || '';
          if (!studentName) return;

          records.push({
            date: today,
            studentName,
            studentId: studentId || '',
            status,
            absentReason: status === 'absent' ? absentReason : '',
            type: 'student',
            instructorEmail: currentUser ? currentUser.email : '',
            instructorName: getCurrentInstructorName() || (currentUser ? currentUser.email : ''),
            schoolId: currentSchoolId || '',
            savedAt: new Date().toISOString()
          });

          if ((status === 'present' || status === 'late') && studentId) {
            const student = data.students.find(s => s.firebaseId === studentId);
            if (student) {
              const newClasses = (student.classes || 0) + 1;
              student.classes = newClasses;
              updatedStudents.push({ id: studentId, name: studentName, classes: newClasses, totalClasses: student.totalClasses || 27 });
            }
          }
        });

        // Save to Firebase with individual error handling
        let firebaseSuccess = true;
        if (typeof db !== 'undefined' && currentSchoolId) {
          try {
            // Use batch write for atomicity
            const batch = db.batch();
            records.forEach(rec => {
              const docId = today + '_' + (rec.studentId || rec.studentName.replace(/\s/g,'_'));
              const ref = db.collection('schools').doc(currentSchoolId).collection('studentAttendance').doc(docId);
              batch.set(ref, rec);
            });
            updatedStudents.forEach(s => {
              const ref = db.collection('schools').doc(currentSchoolId).collection('students').doc(s.id);
              batch.update(ref, { classes: s.classes });
            });
            await batch.commit();
          } catch(e) {
            console.error('Firebase batch save failed, trying individual saves:', e);
            firebaseSuccess = false;
            // Retry individually
            for (const rec of records) {
              try {
                const docId = today + '_' + (rec.studentId || rec.studentName.replace(/\s/g,'_'));
                await db.collection('schools').doc(currentSchoolId).collection('studentAttendance').doc(docId).set(rec);
                firebaseSuccess = true;
              } catch(e2) {
                console.error('Individual save also failed for', rec.studentName, e2.message);
              }
            }
            for (const s of updatedStudents) {
              try {
                await db.collection('schools').doc(currentSchoolId).collection('students').doc(s.id).update({ classes: s.classes });
              } catch(e2) {
                console.error('Class update failed for', s.name, e2.message);
              }
            }
          }
        } else {
          console.warn('Firebase not available — attendance saved locally only');
          firebaseSuccess = false;
        }

        completeStep(3);
        if (firebaseSuccess) {
          showToast('✅ Attendance saved to Firebase! Classes updated.');
        } else {
          showToast('⚠ Saved locally — check your internet connection.');
        }

        updatedStudents.forEach(s => {
          if (s.classes === 22) addNotification(s.name + ' completed 22 classes — eligible for DL Test!', 'success');
          if (s.classes >= s.totalClasses) addNotification(s.name + ' completed all ' + s.totalClasses + ' classes!', 'success');
        });

        renderStudentAttLog();
        renderInstructorStudents();

        if (btn) { btn.disabled = false; btn.textContent = '💾 Save Attendance'; }
      }

      async function renderStudentAttLog() {
        const tbody = document.getElementById('student-att-log-body');
        if (!tbody || !currentSchoolId || typeof db === 'undefined') return;
        try {
          const snap = await db.collection('schools').doc(currentSchoolId)
            .collection('studentAttendance')
            .where('instructorEmail','==', currentUser ? currentUser.email : '')
            .orderBy('date','desc').limit(30).get();
          const records = snap.docs.map(d => d.data());
          if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2);">No records yet.</td></tr>';
            return;
          }
          tbody.innerHTML = records.map(r => {
            const cls = r.status==='present'?'badge-green':r.status==='late'?'badge-amber':'badge-red';
            const student = data.students.find(s => s.firebaseId === r.studentId);
            return '<tr><td>'+r.date+'</td><td>'+r.studentName+'</td><td><span class="badge '+cls+'">'+r.status+'</span></td><td>'+(student?student.classes:'—')+'</td><td>'+(r.notes||'—')+'</td></tr>';
          }).join('');
        } catch(e) { console.warn('Could not load student attendance log:', e.message); }
      }

      // ============================================================
      // RESCHEDULE
      // ============================================================
      function openRescheduleModal(studentName, studentKey) {
        // store both name and key for the reschedule action
        const nameEl = document.getElementById('reschedule-student-name');
        if (nameEl) nameEl.textContent = studentName || '';
        const detailEl = document.getElementById('reschedule-reason-detail');
        if (detailEl) detailEl.value = '';
        const typeEl = document.getElementById('reschedule-reason-type');
        if (typeEl) typeEl.value = '';
        // ensure hidden key field exists
        let keyEl = document.getElementById('reschedule-student-key');
        if (!keyEl) {
          keyEl = document.createElement('input');
          keyEl.type = 'hidden';
          keyEl.id = 'reschedule-student-key';
          const modal = document.getElementById('modal-reschedule');
          if (modal) modal.appendChild(keyEl);
        }
        keyEl.value = studentKey || '';
        openModal('modal-reschedule');
      }

      async function saveReschedule() {
        const reason = document.getElementById('reschedule-reason-type').value;
        const detail = document.getElementById('reschedule-reason-detail').value.trim();
        if (!reason) { alert('Please select a reason for rescheduling'); return; }
        if (!detail) { alert('Please provide a note explaining the reschedule'); return; }
        const studentName = document.getElementById('reschedule-student-name').textContent || '';
        const keyEl = document.getElementById('reschedule-student-key');
        const studentKey = keyEl ? keyEl.value : '';
        // update schedule doc if possible so admin can see the request
        const today = new Date().toISOString().split('T')[0];
        const docId = today + '_' + (studentKey || studentName.replace(/\s+/g,'_'));
        const update = {
          rescheduleRequested: true,
          rescheduleReason: reason,
          rescheduleNote: detail,
          rescheduleRequestedBy: currentUser ? (currentUser.email || currentUser.uid || '') : 'unknown',
          rescheduleRequestedAt: new Date().toISOString(),
          status: 'reschedule_requested'
        };
        try {
          if (typeof FirebaseService !== 'undefined' && FirebaseService.scheduleRef) {
            await FirebaseService.scheduleRef.doc(docId).set(update, { merge: true });
          }
          data.dailySchedule = data.dailySchedule || {};
          data.dailySchedule[docId] = Object.assign({}, data.dailySchedule[docId] || {}, update);
          addNotification(`Reschedule requested for ${studentName} — admin notified`, 'warning');
        } catch (e) {
          console.warn('Could not save reschedule request to Firebase:', e && e.message);
          addNotification(`Reschedule requested for ${studentName} (saved locally)`, 'warning');
        }
        closeModal('modal-reschedule');
      }

      // ============================================================
      // FUEL LOG
      // ============================================================
      function openFuelModal() {
        document.getElementById('fuel-odo-before').value = '';
        document.getElementById('fuel-odo-after').value = '';
        document.getElementById('fuel-litres-new').value = '';
        document.getElementById('fuel-cost-new').value = '';
        document.getElementById('fuel-ppl-new').value = '';
        document.getElementById('fuel-summary-box').style.display = 'none';
        document.getElementById('odo-distance-display').style.display = 'none';
        openModal('modal-fuel');
      }

      function calcPPL() {
        const l = parseFloat(document.getElementById('fuel-litres-new').value);
        const c = parseFloat(document.getElementById('fuel-cost-new').value);
        if (l > 0 && c > 0) {
          const ppl = (c / l).toFixed(2);
          document.getElementById('fuel-ppl-new').value = ppl;
        } else {
          document.getElementById('fuel-ppl-new').value = '';
        }
        updateFuelSummary();
      }

      function calcDistance() {
        const before = parseFloat(document.getElementById('fuel-odo-before').value);
        const after = parseFloat(document.getElementById('fuel-odo-after').value);
        if (before > 0 && after > before) {
          const dist = after - before;
          document.getElementById('odo-distance-display').style.display = 'block';
          document.getElementById('odo-distance-val').textContent = dist.toLocaleString() + ' km';
        } else {
          document.getElementById('odo-distance-display').style.display = 'none';
        }
        updateFuelSummary();
      }

      function updateFuelSummary() {
        const before = document.getElementById('fuel-odo-before').value;
        const litres = document.getElementById('fuel-litres-new').value;
        const amount = document.getElementById('fuel-cost-new').value;
        const ppl = document.getElementById('fuel-ppl-new').value;
        if (before || litres || amount) {
          document.getElementById('fuel-summary-box').style.display = 'block';
          document.getElementById('sum-odo-before').textContent = before ? before + ' km' : '—';
          document.getElementById('sum-litres').textContent = litres ? litres + ' L' : '—';
          document.getElementById('sum-amount').textContent = amount ? '₹' + parseFloat(amount).toLocaleString() : '—';
          document.getElementById('sum-ppl').textContent = ppl ? '₹' + ppl + '/L' : '—';
        } else {
          document.getElementById('fuel-summary-box').style.display = 'none';
        }
      }

      async function submitFuelLog() {
        const odo = document.getElementById('fuel-odo-before').value;
        const litres = document.getElementById('fuel-litres-new').value;
        const cost = document.getElementById('fuel-cost-new').value;
        const date = document.getElementById('fuel-date-new').value || new Date().toISOString().split('T')[0];
        const vehicle = document.getElementById('fuel-vehicle-new') ? document.getElementById('fuel-vehicle-new').value : '';
        const fuelType = document.getElementById('fuel-type-new') ? document.getElementById('fuel-type-new').value : 'petrol';
        const notes = document.getElementById('fuel-notes-new') ? document.getElementById('fuel-notes-new').value : '';
        const odoAfter = document.getElementById('fuel-odo-after').value;
        if (!odo) { alert('Please enter the odometer reading BEFORE refueling'); return; }
        if (!litres || parseFloat(litres) <= 0) { alert('Please enter the number of litres filled'); return; }
        if (!cost || parseFloat(cost) <= 0) { alert('Please enter the amount paid'); return; }

        try {
          const fuelEntry = {
            date,
            vehicle: vehicle || 'Not specified',
            litres: parseFloat(litres),
            cost: parseFloat(cost),
            km: parseInt(odo) || 0,
            odoAfter: parseFloat(odoAfter) || 0,
            fuelType,
            notes,
            instructorId: typeof currentUser !== 'undefined' && currentUser ? currentUser.uid || '' : '',
            instructorEmail: typeof currentUser !== 'undefined' && currentUser ? currentUser.email || '' : '',
            instructorName: getCurrentInstructorName() || (typeof currentUser !== 'undefined' && currentUser ? currentUser.email || 'Unknown' : 'Unknown'),
            schoolId: typeof currentSchoolId !== 'undefined' ? currentSchoolId || '' : '',
            submittedAt: new Date().toISOString(),
            status: 'submitted'
          };

          if (typeof db !== 'undefined' && typeof currentSchoolId !== 'undefined' && currentSchoolId) {
            await db.collection('schools').doc(currentSchoolId).collection('fuel').add({
              ...fuelEntry,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            // Also add as expense transaction for cashflow
            await db.collection('schools').doc(currentSchoolId).collection('transactions').add({
              date, type: 'expense', category: 'Petrol',
              desc: 'Fuel — ' + (vehicle||'Vehicle') + ' by ' + fuelEntry.instructorName,
              amount: parseFloat(cost), schoolId: currentSchoolId,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } else {
            if (typeof data !== 'undefined') {
              data.fuel = data.fuel || [];
              data.fuel.unshift({...fuelEntry, id: Date.now().toString()});
            }
          }

          closeModal('modal-fuel');
          showToast('⛽ Fuel log saved! ₹' + parseFloat(cost).toLocaleString() + ' — ' + litres + 'L');
          // Refresh driver fuel page if visible
          if (typeof renderDriverFuelPage !== 'undefined') renderDriverFuelPage();
        } catch(err) {
          console.error('Fuel log save error:', err);
          closeModal('modal-fuel');
          showToast('⛽ Fuel log submitted (saved locally)');
        }
      }

      // ============================================================
      // TOAST
      // ============================================================
      let toastTimer;
      function showToast(msg) {
        const t = document.getElementById('toast');
        document.getElementById('toast-msg').textContent = msg;
        t.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
      }

      // ============================================================
      // INIT
      // ============================================================
      document.getElementById('att-date-display').textContent =
        'Today — ' + new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

// FUEL — DRIVER (INSTRUCTOR) SIDE
// ============================================================

function openDriverFuelModal() {
  // Populate vehicle dropdown with driver's assigned vehicles
  const vehicleSelect = document.getElementById('fuel-vehicle');
  vehicleSelect.innerHTML = '<option value="">Select your vehicle...</option>';

  // Find vehicles assigned to the current instructor
  const instructorName = getCurrentInstructorName() || currentUser?.email || '';
  const myVehicles = data.vehicles.filter(v =>
    v.instructor && (v.instructor.toLowerCase().includes(instructorName.toLowerCase()) || instructorName.toLowerCase().includes(v.instructor.toLowerCase()))
  );

  if (myVehicles.length > 0) {
    myVehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = `${v.name} (${v.reg})`;
      opt.textContent = `${v.name} — ${v.reg}`;
      vehicleSelect.appendChild(opt);
    });
  } else {
    // Fallback: show all vehicles if no specific assignment found
    data.vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = `${v.name} (${v.reg})`;
      opt.textContent = `${v.name} — ${v.reg}`;
      vehicleSelect.appendChild(opt);
    });
  }

  // Auto-calculate price per litre when litres/cost changes
  const litresInput = document.getElementById('fuel-litres');
  const costInput = document.getElementById('fuel-cost');
  const pplInput = document.getElementById('fuel-ppl');

  function calcPPL() {
    const l = parseFloat(litresInput.value);
    const c = parseFloat(costInput.value);
    if (l > 0 && c > 0) {
      pplInput.value = (c / l).toFixed(2);
    } else {
      pplInput.value = '';
    }
  }
  litresInput.oninput = calcPPL;
  costInput.oninput = calcPPL;

  openModal('modal-add-fuel');
}

async function addDriverFuelEntry() {
  const date = document.getElementById('fuel-date').value || new Date().toISOString().split('T')[0];
  const vehicle = document.getElementById('fuel-vehicle').value;
  const litres = parseFloat(document.getElementById('fuel-litres').value) || 0;
  const cost = parseFloat(document.getElementById('fuel-cost').value) || 0;
  const km = parseInt(document.getElementById('fuel-km').value) || 0;
  const notes = document.getElementById('fuel-notes').value.trim();

  if (!vehicle) { alert('Please select your vehicle'); return; }
  if (litres <= 0) { alert('Please enter litres filled'); return; }
  if (cost <= 0) { alert('Please enter fuel cost'); return; }

  try {
    const fuelEntry = {
      date,
      vehicle,
      litres,
      cost,
      km,
      notes,
      instructorId: currentUser?.uid || '',
      instructorEmail: currentUser?.email || '',
      instructorName: getCurrentInstructorName() || currentUser?.email || 'Unknown Driver',
      schoolId: currentSchoolId || '',
      submittedAt: new Date().toISOString(),
      status: 'submitted'
    };

    // Save to Firebase under school's fuel collection
    if (currentSchoolId) {
      await FirebaseService.addDocument(FirebaseService.fuelRef, fuelEntry);
    } else {
      // Fallback local save
      data.fuel.unshift({ ...fuelEntry, id: Date.now().toString() });
    }

    // Also add as expense transaction
    if (cost > 0 && currentSchoolId) {
      await FirebaseService.addTransaction({
        date,
        type: 'expense',
        category: 'Petrol',
        desc: `Fuel – ${vehicle} by ${fuelEntry.instructorName}`,
        amount: cost
      });
    }

    closeModal('modal-add-fuel');

    // Clear form
    document.getElementById('fuel-date').value = '';
    document.getElementById('fuel-vehicle').value = '';
    document.getElementById('fuel-litres').value = '';
    document.getElementById('fuel-cost').value = '';
    document.getElementById('fuel-km').value = '';
    document.getElementById('fuel-notes').value = '';
    document.getElementById('fuel-ppl').value = '';

    addNotification(`Fuel log submitted: ${vehicle} — ₹${cost.toLocaleString()} (${litres}L)`, 'success');
    renderDriverFuelPage();
    // Refresh owner fuel dashboard if owner is viewing
    if (typeof renderOwnerFuelDashboard === 'function') renderOwnerFuelDashboard();

  } catch (error) {
    console.error('Error saving fuel entry:', error);
    alert('Error saving fuel entry. Please try again.');
  }
}

async function renderDriverFuelPage() {
  // Load fuel data from Firebase for this instructor
  let myFuel = [];
  try {
    if (currentSchoolId) {
      const snapshot = await FirebaseService.fuelRef
        .where('instructorEmail', '==', currentUser?.email || '')
        .orderBy('date', 'desc')
        .get().catch(() => null);

      if (snapshot) {
        myFuel = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
        // Fallback: filter local data
        myFuel = data.fuel.filter(f => f.instructorEmail === currentUser?.email);
      }
    } else {
      myFuel = data.fuel.filter(f => f.instructorEmail === currentUser?.email);
    }
  } catch (e) {
    console.warn('Fuel query fallback:', e.message);
    myFuel = data.fuel.filter(f => f.instructorEmail === currentUser?.email);
  }

  // Update vehicle banner
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthFuel = myFuel.filter(f => f.date?.startsWith(thisMonth));
  const monthCost = monthFuel.reduce((s, f) => s + (f.cost || 0), 0);
  const monthKm = monthFuel.reduce((s, f) => s + (f.km || 0), 0);

  // Find assigned vehicle
  const instructorName = getCurrentInstructorName() || currentUser?.email || '';
  const myVehicle = data.vehicles.find(v =>
    v.instructor && (v.instructor.toLowerCase().includes(instructorName.toLowerCase()) || instructorName.toLowerCase().includes(v.instructor.toLowerCase()))
  );

  const vehicleNameEl = document.getElementById('driver-vehicle-name');
  const vehicleRegEl = document.getElementById('driver-vehicle-reg');
  if (vehicleNameEl) vehicleNameEl.textContent = myVehicle ? myVehicle.name : 'No vehicle assigned yet';
  if (vehicleRegEl) vehicleRegEl.textContent = myVehicle ? myVehicle.reg : 'Contact office to get a vehicle assigned';

  // Update stats
  const monthFuelEl = document.getElementById('driver-fuel-month');
  const monthKmEl = document.getElementById('driver-fuel-km');
  const fillsEl = document.getElementById('driver-fuel-fills');
  const bannerFuelEl = document.getElementById('driver-month-fuel');
  if (monthFuelEl) monthFuelEl.textContent = `₹${monthCost.toLocaleString()}`;
  if (bannerFuelEl) bannerFuelEl.textContent = `₹${monthCost.toLocaleString()}`;
  if (monthKmEl) monthKmEl.textContent = monthKm.toLocaleString();
  if (fillsEl) fillsEl.textContent = myFuel.length;

  // Render table
  const tb = document.getElementById('driver-fuel-table');
  if (!tb) return;

  if (myFuel.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text2);">No fuel entries yet. Click "+ Log Fuel Fill" to add one.</td></tr>';
    return;
  }

  tb.innerHTML = myFuel.map(f => `
    <tr>
      <td style="color:var(--text2);font-size:12px;">${f.date}</td>
      <td style="font-size:12px;font-weight:500;">${f.vehicle || '—'}</td>
      <td><strong>${f.litres}L</strong></td>
      <td style="font-weight:600;color:var(--danger);">₹${(f.cost||0).toLocaleString()}</td>
      <td style="color:var(--text2);font-size:12px;">${f.km ? f.km.toLocaleString() + ' km' : '—'}</td>
      <td style="font-size:12px;color:var(--text2);">${f.notes || '—'}</td>
      <td><span class="badge ${f.status === 'submitted' ? 'badge-green' : 'badge-gray'}">${f.status || 'submitted'}</span></td>
    </tr>
  `).join('');
}

// ============================================================

// INSTRUCTOR STUDENTS
// ============================================================
function renderInstructorStudents() {
  const list = document.getElementById('instructor-students-list');
  if(!list) return;

  const currentEmail = (currentUser ? currentUser.email : '').toLowerCase().trim();
  const instructorName = getCurrentInstructorName();
  const currentDisplayName = (currentUser ? (currentUser.displayName || '') : '').toLowerCase().trim();

  const allStudents = (data.students || []).filter(s => (currentSchoolId ? s.schoolId === currentSchoolId : true));

  // Multi-strategy matching: email, instructorName, displayName, partial
  function isMyStudent(s) {
    const sEmail = (s.instructorEmail || s.instructor || '').toLowerCase().trim();
    const sName  = (s.instructor || s.instructorName || '').toLowerCase().trim();
    if (currentEmail && sEmail === currentEmail) return true;
    if (instructorName && sName === instructorName.toLowerCase().trim()) return true;
    if (currentDisplayName && sName === currentDisplayName) return true;
    if (currentEmail && sName && currentEmail.startsWith(sName)) return true;
    if (currentEmail && sEmail && sEmail.split('@')[0] === currentEmail.split('@')[0]) return true;
    return false;
  }

  const byRecord = allStudents.filter(s => isMyStudent(s));

  // Also include students scheduled for this instructor today
  const today = new Date().toISOString().split('T')[0];
  const scheduleMap = (typeof data !== 'undefined' && data.dailySchedule) ? data.dailySchedule : {};
  const scheduledForMe = [];
  Object.values(scheduleMap).forEach(entry => {
    if (!entry || entry.date !== today) return;
    const instEmail = (entry.instructorEmail || '').toLowerCase();
    const instName  = (entry.instructorName || entry.instructor || '').toLowerCase();
    const matches = (currentEmail && instEmail === currentEmail) ||
                    (instructorName && instName === instructorName.toLowerCase()) ||
                    (currentDisplayName && instName === currentDisplayName);
    if (matches) {
      const key = entry.studentId || entry.studentName || '';
      const stud = allStudents.find(ss =>
        (getStudentKey(ss) === key) || (ss.firebaseId === key) || (ss.id === key) || (ss.studentId === key) || (ss.name === key)
      );
      if (stud && !scheduledForMe.some(x => getStudentKey(x) === getStudentKey(stud))) {
        scheduledForMe.push(stud);
      }
    }
  });

  const myStudents = (() => {
    const map = {};
    byRecord.concat(scheduledForMe).forEach(s => { map[getStudentKey(s)] = s; });
    return Object.values(map);
  })();

  // Debug info
  console.log('renderInstructorStudents: currentEmail=', currentEmail, '| instructorName=', instructorName);
  console.log('renderInstructorStudents: allStudents=', allStudents.length, '| byRecord=', byRecord.length, '| scheduledForMe=', scheduledForMe.length, '| total=', myStudents.length);

  if (myStudents.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2);">
      <div style="font-size:48px;margin-bottom:16px;">👥</div>
      <div style="font-size:16px;font-weight:500;margin-bottom:8px;">No students assigned yet</div>
      <div style="font-size:13px;">Students assigned to you by the office will appear here.</div>
      <div style="font-size:11px;margin-top:8px;color:var(--text3);">Your login: ${currentEmail}</div>
    </div>`;
    return;
  }

  list.innerHTML = `<div class="two-col">` + myStudents.map(s => `
    <div class="card" style="margin:0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div class="avatar" style="width:46px;height:46px;font-size:16px;background:${COLORS[(typeof s.id==='number'?s.id:(s.name||'').charCodeAt(0)||0)%COLORS.length]}22;color:${COLORS[(typeof s.id==='number'?s.id:(s.name||'').charCodeAt(0)||0)%COLORS.length]};">
          ${s.name.split(' ').map(x=>x[0]).join('')}
        </div>
        <div>
          <div style="font-weight:600;font-size:15px;">${s.name}</div>
          <div style="font-size:12px;color:var(--text2);">${s.phone}</div>
        </div>
        <span class="badge ${s.status==='Active'?'badge-green':'badge-amber'}" style="margin-left:auto;">${s.status}</span>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px;">${s.vehicle}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;">Class Time: <strong>${s.classTime || '—'}</strong></div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span>Classes</span><span style="font-weight:600;">${s.classes}/${s.totalClasses||27}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${Math.min(100,Math.round(s.classes/(s.totalClasses||27)*100))}%;background:${s.classes>=(s.totalClasses||27)?'var(--success)':'var(--accent2)'}"></div>
        </div>
      </div>
      ${s.classes>=(s.totalClasses||27)?`<div class="alert alert-success" style="padding:8px 12px;font-size:12px;">✓ Eligible for DL Test</div>`:''}
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="updateClasses('${s.firebaseId||s.id}')">+ Mark Class</button>
        <button class="btn btn-primary btn-sm" onclick="viewStudent('${s.firebaseId||s.id}')">View</button>
      </div>
    </div>
  `).join('') + `</div>`;
}

  // Also include students scheduled for this instructor today (even if record not assigned)

async function updateClasses(firebaseId) {
  if (!firebaseId || !currentSchoolId) {
    showToast('⚠ Cannot update — student ID missing'); return;
  }
  try {
    const ref = db.collection('schools').doc(currentSchoolId).collection('students').doc(String(firebaseId));
    const doc = await ref.get();
    if (!doc.exists) { showToast('⚠ Student not found in database'); return; }
    const student = { ...doc.data(), firebaseId: doc.id };
    const maxClasses = student.totalClasses || 27;
    if (student.classes >= maxClasses) {
      showToast('✅ Student has already completed all ' + maxClasses + ' classes');
      return;
    }
    const newClasses = (student.classes || 0) + 1;
    await ref.update({ classes: newClasses });
    // Update local data
    const local = data.students.find(s => s.firebaseId === String(firebaseId));
    if (local) local.classes = newClasses;

    if (newClasses === 22) addNotification(student.name + ' completed 22 classes — eligible for DL test!', 'success');
    if (newClasses >= maxClasses) addNotification(student.name + ' completed all ' + maxClasses + ' classes!', 'success');

    showToast('✅ Class marked — ' + student.name + ' now has ' + newClasses + '/' + maxClasses + ' classes');
    renderInstructorStudents();
  } catch (error) {
    console.error('Error updating classes:', error);
    showToast('⚠ Error updating classes. Please try again.');
  }
}

// ============================================================
