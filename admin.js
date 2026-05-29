// DrivePro admin and staff management code.
// ADMIN MANAGEMENT
// ============================================================

// Clear all admin data from Firebase
async function clearAllAdminsFromFirebase() {
  try {
    if (!currentSchoolId) {
      alert('Please select a school first');
      return;
    }
    
    const adminsRef = FirebaseService.schoolsRef.doc(currentSchoolId).collection('users');
    const snapshot = await adminsRef.get();
    
    if (snapshot.empty) {
      alert('No administrators found to clear');
      return;
    }
    
    const adminCount = snapshot.docs.length;
    if (!confirm(`Are you sure you want to remove ALL ${adminCount} administrators from this school? This action cannot be undone.`)) {
      return;
    }
    
    // Delete all admin documents
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    // Clear local data
    data.admins = [];
    
    // Refresh display
    renderAdminsTable();
    
    alert(`Successfully removed ${adminCount} administrators`);
  } catch (error) {
    console.error('Error clearing admins:', error);
    alert('Error clearing administrators: ' + error.message);
  }
}

// Render admins table
function renderAdminsTable() {
  const tb = document.getElementById('admins-table');
  if (!tb) return;
  
  // Check if school is selected
  if (!currentSchoolId) {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);">Please select a school to view administrators</td></tr>';
    return;
  }
  
  // Check if user has permission to view admins
  if (!hasPageAccess('admin-management')) {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);">You do not have permission to view this page</td></tr>';
    return;
  }
  
  if (!data.admins || data.admins.length === 0) {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);">No administrators added yet</td></tr>';
    return;
  }
  
  // Remove duplicates - use email as primary key, fallback to userId/firebaseId
  const seenEmails = new Set();
  const uniqueAdmins = [];
  
  for (const admin of data.admins) {
    const key = admin.email || admin.userId || admin.firebaseId || admin.id;
    if (!seenEmails.has(key)) {
      seenEmails.add(key);
      uniqueAdmins.push(admin);
    }
  }
  
  tb.innerHTML = uniqueAdmins.map(admin => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar" style="background:${COLORS[(admin.id || 0)%COLORS.length]}22;color:${COLORS[(admin.id || 0)%COLORS.length]};">
            ${(admin.name || 'Unknown').split(' ').map(x=>x[0]).join('')}
          </div>
          <div>
            <div style="font-weight:500">${admin.name || 'Unknown'}</div>
            <div style="font-size:11px;color:var(--text2)">${admin.phone || 'No phone'}</div>
          </div>
        </div>
      </td>
      <td>${admin.email || 'No email'}</td>
      <td><span class="badge ${admin.role === 'office' ? 'badge-blue' : 'badge-green'}">${admin.role === 'office' ? 'Office Admin' : (admin.role === 'instructor' ? 'Instructor' : 'Unknown')}</span></td>
      <td><span class="badge ${admin.status === 'active' ? 'badge-green' : 'badge-red'}">${admin.status || 'Unknown'}</span></td>
      <td style="color:var(--text2);font-size:12px;">${admin.addedOn || admin.createdAt || 'Unknown'}</td>
      <td>
        <div style="display:flex;gap:5px;">
          <button class="btn btn-outline btn-sm" onclick="editAdmin('${admin.email || 'unknown'}')" data-action="edit_admin">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="removeAdmin('${admin.email || 'unknown'}')" data-action="remove_admin">Remove</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Add admin from modal
async function addAdminFromModal() {
  // Check if user has permission to add admins
  if (!hasActionPermission('add_admin')) {
    alert('You do not have permission to add administrators.');
    return;
  }
  
  const schoolId = document.getElementById('admin-school').value;
  const name = document.getElementById('admin-name').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  const confirmPassword = document.getElementById('admin-confirm-password').value;
  const role = document.getElementById('admin-role').value;
  const phone = document.getElementById('admin-phone').value.trim();
  
  // Validation
  if (!schoolId || !name || !email || !password || !confirmPassword || !phone) {
    alert('Please fill in all required fields');
    return;
  }
  
  if (!validateEmail(email)) {
    alert('Please enter a valid email address');
    return;
  }
  
  if (password.length < 6) {
    alert('Password must be at least 6 characters long');
    return;
  }
  
  if (password !== confirmPassword) {
    alert('Passwords do not match');
    return;
  }
  
  // Check if admin already exists
  if (data.admins.some(admin => admin.email === email)) {
    alert('An administrator with this email already exists');
    return;
  }
  
  let secondaryAuth = null;
  let secondaryAppForIndex = null;

  try {
    // Get permissions
    const permissions = {
      students: document.getElementById('perm-students').checked,
      transactions: document.getElementById('perm-transactions').checked,
      attendance: document.getElementById('perm-attendance').checked,
      reports: document.getElementById('perm-reports').checked
    };
    
    // Normalize role to match login buttons
    const normalizedRole = (role === 'admin') ? 'office' : role;

    // Create admin data
    const adminData = {
      name,
      email,
      password,
      role: normalizedRole,
      userRole: normalizedRole,
      phone,
      status: 'active',
      addedOn: new Date().toISOString().split('T')[0],
      permissions,
      schoolId: schoolId,
      ...FirebaseService.getOwnerScope(schoolId),
      userId: null,      // filled in below once we have the UID
      firebaseId: null
    };

    // Create the Firebase Auth account via a secondary app so the owner
    // session is not disrupted
    let adminUid = null;
    try {
      const secondaryApp =
        firebase.apps.find(a => a.name === 'secondary') ||
        firebase.initializeApp(firebase.app().options, 'secondary');
      secondaryAppForIndex = secondaryApp;
      secondaryAuth = secondaryApp.auth();
      const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      adminUid = cred.user.uid;
      console.log('Admin Firebase Auth account created, UID:', adminUid);
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        addNotification('This email already has a Firebase account. The admin can log in but may need the owner to fix their access doc.', 'warning');
        // We don't know the UID client-side; skip UID-based write
      } else {
        throw authErr;
      }
    }

    adminData.userId = adminUid;
    adminData.firebaseId = adminUid;

    // Add to local list
    data.admins.push(adminData);

    // Save to Firebase — use UID as doc ID so isSchoolMember() rule works
    if (schoolId) {
      if (adminUid) {
        // Write membership doc with UID as document ID
        await FirebaseService.schoolsRef
          .doc(schoolId)
          .collection('users')
          .doc(adminUid)
          .set(adminData);

        // Write /userSchools/{uid} with the newly-created admin's own auth session.
        // Firestore rules commonly allow users to write only their own index doc,
        // so doing this as the owner can fail with "insufficient permissions".
        await writeUserSchoolsIndexAsCreatedUser(
          secondaryAppForIndex,
          adminUid,
          schoolId,
          normalizedRole,
          FirebaseService.getOwnerScope(schoolId).ownerEmail
        );

        console.log('Admin saved with UID doc ID and userSchools index written');
      } else {
        // Fallback: no UID available, save with auto-ID (limited functionality)
        await FirebaseService.addDocument(
          FirebaseService.schoolsRef.doc(schoolId).collection('users'),
          adminData
        );
        console.warn('Admin saved with auto-ID — login may not work until UID doc is created');
      }
    }
    
    // Get school name for credentials display
    const selectedSchool = userSchools.find(s => s.id === schoolId);
    const schoolName = selectedSchool ? selectedSchool.name : 'Unknown School';
    
    // Show credentials to owner
    showAdminCredentials(name, email, password, role, schoolName);
    
    // Clear form and close modal
    document.getElementById('admin-school').value = '';
    document.getElementById('admin-name').value = '';
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-confirm-password').value = '';
    document.getElementById('admin-phone').value = '';
    document.getElementById('admin-role').value = 'office';
    
    // Reset permissions
    document.getElementById('perm-students').checked = true;
    document.getElementById('perm-transactions').checked = true;
    document.getElementById('perm-attendance').checked = true;
    document.getElementById('perm-reports').checked = true;
    
    closeModal('modal-add-admin');
    renderAdminsTable();
    addNotification(`Administrator "${name}" has been added successfully`, 'success');
    
  } catch (error) {
    console.error('Error adding admin:', error);
    alert('Error adding administrator. Please try again.');
  } finally {
    if (secondaryAuth) {
      try { await secondaryAuth.signOut(); } catch (e) { console.warn('Secondary admin sign-out failed:', e.message); }
    }
  }
}

// Show admin credentials to owner
function showAdminCredentials(name, email, password, role, schoolName) {
  const credentialsHtml = `
    <div class="modal-overlay" id="modal-admin-credentials" style="display: flex;">
      <div class="modal" style="max-width: 500px;">
        <div class="modal-header">
          <h3>Administrator Account Created</h3>
          <button class="modal-close" onclick="closeAdminCredentials()">✕</button>
        </div>
        <div class="modal-body">
          <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <h4 style="color: #0369a1; margin: 0 0 12px 0;">🎉 Administrator Added Successfully!</h4>
            <p style="color: #0c4a6e; margin: 0; font-size: 14px;">Please share these login credentials with <strong>${name}</strong></p>
          </div>
          
          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">School:</label>
              <div style="background: #f0f9ff; padding: 8px 12px; border-radius: 4px; font-family: monospace; border: 1px solid #0ea5e9;">${schoolName}</div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Name:</label>
              <div style="background: #f9fafb; padding: 8px 12px; border-radius: 4px; font-family: monospace;">${name}</div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Email:</label>
              <div style="background: #f9fafb; padding: 8px 12px; border-radius: 4px; font-family: monospace;">${email}</div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Password:</label>
              <div style="background: #fef3c7; padding: 8px 12px; border-radius: 4px; font-family: monospace; border: 1px solid #f59e0b;">${password}</div>
            </div>
            
            <div style="margin-bottom: 12px;">
              <label style="display: block; font-weight: 600; color: #374151; margin-bottom: 4px;">Role:</label>
              <div style="background: #f9fafb; padding: 8px 12px; border-radius: 4px;">${role === 'office' ? 'Office Administrator' : 'Instructor'}</div>
            </div>
          </div>
          
          <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 16px;">
            <p style="color: #991b1b; margin: 0; font-size: 13px;">
              <strong>⚠️ Important:</strong> Store these credentials securely. The administrator should change their password after first login.
            </p>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
          <button class="btn btn-accent" onclick="copyAdminCredentials('${name}', '${email}', '${password}', '${schoolName}')">📋 Copy Credentials</button>
          <button class="btn btn-primary" onclick="closeAdminCredentials()">Done</button>
        </div>
      </div>
    </div>
  `;
  
  // Add to body
  document.body.insertAdjacentHTML('beforeend', credentialsHtml);
}

// Close admin credentials modal
function closeAdminCredentials() {
  const modal = document.getElementById('modal-admin-credentials');
  if (modal) {
    modal.remove();
  }
}

// Copy admin credentials to clipboard
function copyAdminCredentials(name, email, password, schoolName) {
  const credentials = `Administrator Login Credentials:\n\nSchool: ${schoolName}\nName: ${name}\nEmail: ${email}\nPassword: ${password}\n\nPlease save these credentials securely and change your password after first login.`;
  
  if (navigator.clipboard) {
    navigator.clipboard.writeText(credentials).then(() => {
      addNotification('Credentials copied to clipboard!', 'success');
    }).catch(() => {
      // Fallback
      prompt('Copy these credentials:', credentials);
    });
  } else {
    // Fallback for older browsers
    prompt('Copy these credentials:', credentials);
  }
}

// Populate school dropdown for admin management
function populateAdminSchoolDropdown() {
  const schoolSelect = document.getElementById('admin-school');
  if (!schoolSelect) return;
  
  schoolSelect.innerHTML = '<option value="">Choose a school...</option>';
  
  if (currentRole === 'owner' && userSchools.length > 0) {
    userSchools.forEach(school => {
      const option = document.createElement('option');
      option.value = school.id;
      option.textContent = school.name;
      if (currentSchoolId === school.id) {
        option.selected = true;
      }
      schoolSelect.appendChild(option);
    });
  } else if (currentSchoolId) {
    // For office/instructor roles, show current school
    const currentSchool = userSchools.find(s => s.id === currentSchoolId);
    if (currentSchool) {
      const option = document.createElement('option');
      option.value = currentSchool.id;
      option.textContent = currentSchool.name;
      option.selected = true;
      schoolSelect.appendChild(option);
    }
  }
}

// Edit admin
function editAdmin(adminId) {
  if (!hasActionPermission('edit_admin')) {
    alert('You do not have permission to edit administrators.');
    return;
  }
  
  console.log('Looking for admin with ID:', adminId);
  console.log('All admins in data.admins:', data.admins.map((a, i) => ({
    index: i,
    id: a.id,
    firebaseId: a.firebaseId,
    name: a.name,
    email: a.email
  })));
  
  const admin = data.admins.find(a => 
    a.email === adminId || 
    a.userId === adminId || 
    a.firebaseId === adminId || 
    a.id === adminId
  );
  console.log('Found admin:', admin);
  
  if (!admin) {
    console.log('Admin not found for ID:', adminId);
    console.log('Available admins:', data.admins.map(a => ({id: a.id, firebaseId: a.firebaseId, name: a.name})));
    alert('Administrator not found');
    return;
  }
  
  // Populate school dropdown
  populateAdminSchoolDropdown();
  
  // Populate modal with admin data
  document.getElementById('admin-name').value = admin.name;
  document.getElementById('admin-email').value = admin.email;
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-confirm-password').value = '';
  document.getElementById('admin-role').value = admin.role;
  document.getElementById('admin-phone').value = admin.phone;
  
  // Set school selection
  if (admin.schoolId) {
    document.getElementById('admin-school').value = admin.schoolId;
  }
  
  // Set permissions
  document.getElementById('perm-students').checked = admin.permissions.students;
  document.getElementById('perm-transactions').checked = admin.permissions.transactions;
  document.getElementById('perm-attendance').checked = admin.permissions.attendance;
  document.getElementById('perm-reports').checked = admin.permissions.reports;
  
  // Change button text and onclick
  const addBtn = document.querySelector('button[onclick="addAdminFromModal()"]');
  if (addBtn) {
    addBtn.textContent = 'Update Administrator';
    addBtn.onclick = () => updateAdmin(adminId);
  }
  
  openModal('modal-add-admin');
}

// Update admin
async function updateAdmin(adminId) {
  if (!hasActionPermission('edit_admin')) {
    alert('You do not have permission to edit administrators.');
    return;
  }
  
  const schoolId = document.getElementById('admin-school').value;
  const name = document.getElementById('admin-name').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  const confirmPassword = document.getElementById('admin-confirm-password').value;
  const role = document.getElementById('admin-role').value;
  const phone = document.getElementById('admin-phone').value.trim();
  
  // Validation
  if (!name || !email || !phone) {
    alert('Please fill in all required fields');
    return;
  }
  
  // Password validation only if password is provided
  if (password || confirmPassword) {
    if (password.length < 6) {
      alert('Password must be at least 6 characters long');
      return;
    }
    
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
  }
  
  try {
    // Get permissions
    const permissions = {
      students: document.getElementById('perm-students').checked,
      transactions: document.getElementById('perm-transactions').checked,
      attendance: document.getElementById('perm-attendance').checked,
      reports: document.getElementById('perm-reports').checked
    };
    
    // Update admin data
    const adminIndex = data.admins.findIndex(a => a.id === adminId);
    if (adminIndex !== -1) {
      const admin = data.admins[adminIndex];
      const updatedAdmin = {
        ...admin,
        name,
        email,
        role,
        phone,
        permissions
      };
      
      // Update school if changed
      if (schoolId) {
        updatedAdmin.schoolId = schoolId;
      }
      
      // Only update password if a new one is provided
      if (password) {
        updatedAdmin.password = password; // In production, this should be hashed
      }
      
      data.admins[adminIndex] = updatedAdmin;
      
      // Update in Firebase using the correct document ID
      const targetSchoolId = schoolId || admin.schoolId;
      if (targetSchoolId && admin.firebaseId) {
        console.log('Updating admin in Firebase with ID:', admin.firebaseId);
        await FirebaseService.updateDocument(
          FirebaseService.schoolsRef.doc(targetSchoolId).collection('users'),
          admin.firebaseId, // Use Firebase document ID
          updatedAdmin
        );
      } else {
        console.log('Cannot update in Firebase - no firebaseId or schoolId found for admin:', adminId);
      }
    }
    
    // Reset button
    const addBtn = document.querySelector('button[onclick*="updateAdmin"]');
    if (addBtn) {
      addBtn.textContent = 'Add Administrator';
      addBtn.onclick = addAdminFromModal;
    }
    
    // Clear form
    document.getElementById('admin-school').value = '';
    document.getElementById('admin-name').value = '';
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-confirm-password').value = '';
    document.getElementById('admin-phone').value = '';
    document.getElementById('admin-role').value = 'office';
    
    // Reset permissions
    document.getElementById('perm-students').checked = true;
    document.getElementById('perm-transactions').checked = true;
    document.getElementById('perm-attendance').checked = true;
    document.getElementById('perm-reports').checked = true;
    
    closeModal('modal-add-admin');
    renderAdminsTable();
    addNotification(`Administrator "${name}" has been updated successfully`, 'success');
    
  } catch (error) {
    console.error('Error updating admin:', error);
    alert('Error updating administrator. Please try again.');
  }
}

// Remove admin
async function removeAdmin(adminId) {
  if (!hasActionPermission('remove_admin')) {
    alert('You do not have permission to remove administrators.');
    return;
  }
  
  const admin = data.admins.find(a => 
    a.email === adminId || 
    a.userId === adminId || 
    a.firebaseId === adminId || 
    a.id === adminId
  );
  if (!admin) {
    alert('Administrator not found');
    return;
  }
  
  const confirmed = confirm(`Are you sure you want to remove "${admin.name || 'Unknown'}" as administrator? This action cannot be undone.`);
  
  if (!confirmed) return;
  
  try {
    
    // Remove from data using the same identifier logic
    data.admins = data.admins.filter(a => 
      (a.email || a.userId || a.firebaseId || a.id) !== adminId
    );
    
    // Remove from Firebase using the document ID
    if (currentSchoolId) {
      const docId = admin.firebaseId || admin.id; // Use firebaseId or fallback to id
      console.log('Removing admin from Firebase with ID:', docId);
      await FirebaseService.deleteDocument(
        FirebaseService.schoolsRef.doc(currentSchoolId).collection('users'),
        docId
      );
    } else {
      console.log('Cannot remove from Firebase - no school selected');
    }
    
    renderAdminsTable();
    addNotification(`Administrator "${admin.name}" has been removed`, 'info');
    
  } catch (error) {
    console.error('Error removing admin:', error);
    alert('Error removing administrator. Please try again.');
  }
}

// Email validation helper
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Toggle password visibility
function togglePasswordVisibility(fieldId) {
  const passwordField = document.getElementById(fieldId);
  const iconElement = document.getElementById(fieldId + '-icon');
  
  if (passwordField.type === 'password') {
    passwordField.type = 'text';
    iconElement.textContent = '👁';
  } else {
    passwordField.type = 'password';
    iconElement.textContent = '👁';
  }
}

// Toggle login password visibility
function toggleLoginPasswordVisibility() {
  const passwordField = document.getElementById('login-pass');
  const iconElement = document.getElementById('login-password-icon');
  
  if (passwordField.type === 'password') {
    passwordField.type = 'text';
    iconElement.textContent = '👁';
  } else {
    passwordField.type = 'password';
    iconElement.textContent = '👁';
  }
}

// Open admin modal with school dropdown populated
function openAdminModal() {
  populateAdminSchoolDropdown();
  openModal('modal-add-admin');
}

async function repairAdminLoginAccess() {
  if (!currentSchoolId) {
    alert('Please select the school for this admin first.');
    return;
  }
  if (currentRole !== 'owner') {
    alert('Only the owner can repair admin login access.');
    return;
  }

  const email = prompt('Admin email to repair:');
  if (!email) return;
  const password = prompt('Admin password:');
  if (!password) return;
  const roleInput = (prompt('Role for this account: office or instructor', 'office') || 'office').trim().toLowerCase();
  const normalizedRole = roleInput === 'instructor' ? 'instructor' : 'office';

  let secondaryAuth = null;
  let secondaryAppForIndex = null;
  try {
    const secondaryApp =
      firebase.apps.find(a => a.name === 'secondary') ||
      firebase.initializeApp(firebase.app().options, 'secondary');
    secondaryAppForIndex = secondaryApp;
    secondaryAuth = secondaryApp.auth();

    const cred = await secondaryAuth.signInWithEmailAndPassword(email.trim(), password);
    const uid = cred.user.uid;
    let ownerEmail = currentUser ? currentUser.email : null;

    try {
      const schoolDoc = await db.collection('schools').doc(currentSchoolId).get();
      if (schoolDoc.exists) ownerEmail = schoolDoc.data().ownerEmail || ownerEmail;
    } catch (schoolErr) {
      console.warn('Could not read school owner email during repair:', schoolErr.message);
    }

    await db.collection('schools').doc(currentSchoolId).collection('users').doc(uid).set({
      userId: uid,
      firebaseId: uid,
      role: normalizedRole,
      userRole: normalizedRole,
      email: email.trim(),
      schoolId: currentSchoolId,
      ownerEmail,
      status: 'active',
      repairedAt: new Date().toISOString()
    }, { merge: true });

    await writeUserSchoolsIndexAsCreatedUser(
      secondaryAppForIndex,
      uid,
      currentSchoolId,
      normalizedRole,
      ownerEmail
    );

    addNotification('Admin login access repaired successfully.', 'success');
    alert('Done. Ask the admin to log in again as ' + normalizedRole + '.');
  } catch (error) {
    console.error('Admin login repair failed:', error);
    alert('Repair failed: ' + error.message);
  } finally {
    if (secondaryAuth) {
      try { await secondaryAuth.signOut(); } catch (e) { console.warn('Secondary repair sign-out failed:', e.message); }
    }
  }
}

// ============================================================

// STAFF MANAGEMENT FUNCTIONS
// ============================================================

// Clear all staff from Firebase
async function clearAllStaffFromFirebase() {
  if (!confirm('Are you sure you want to remove ALL staff members? This action cannot be undone.')) {
    return;
  }
  
  try {
    if (currentSchoolId) {
      const staffRef = db.collection('schools').doc(currentSchoolId).collection('staff');
      const snapshot = await staffRef.get();
      const batch = db.batch();
      
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      // Update local data
      if (!data.staff) data.staff = [];
      data.staff = [];
      
      // Refresh display
      renderStaffTable();
      
      alert(`Successfully removed all staff members`);
    } else {
      console.log('Cannot remove from Firebase - no school selected');
    }
    
  } catch (error) {
    console.error('Error clearing staff:', error);
    alert('Error clearing staff. Please try again.');
  }
}

// Repair login access for legacy staff missing userSchools/users docs
// Run this as owner to fix staff who get "not authorized for this role" on login
async function repairStaffLoginAccess() {
  if (!currentSchoolId) {
    alert('Please select a school first.');
    return;
  }
  if (currentRole !== 'owner' && currentRole !== 'admin') {
    alert('Only the owner or admin can run this repair.');
    return;
  }

  const btn = event.target;
  btn.textContent = '🔧 Repairing...';
  btn.disabled = true;

  try {
    // Read the school doc to get ownerEmail
    const schoolDoc = await db.collection('schools').doc(currentSchoolId).get();
    const ownerEmail = schoolDoc.exists ? (schoolDoc.data().ownerEmail || null) : null;

    // Read all staff docs
    const staffSnap = await db.collection('schools').doc(currentSchoolId).collection('staff').get();
    if (staffSnap.empty) {
      alert('No staff found in this school.');
      btn.textContent = '🔧 Fix Login Access';
      btn.disabled = false;
      return;
    }

    let fixed = 0;
    let skipped = 0;

    for (const staffDoc of staffSnap.docs) {
      const s = staffDoc.data();
      const uid = s.userId || s.firebaseId || staffDoc.id;
      if (!uid || uid === s.email) { skipped++; continue; } // placeholder UID — can't fix

      const normalizedRole = s.role === 'instructor' ? 'instructor' : 'office';

      // Write /schools/{id}/users/{uid}
      try {
        await db.collection('schools').doc(currentSchoolId).collection('users').doc(uid).set({
          userId: uid,
          role: normalizedRole,
          userRole: normalizedRole,
          name: s.name || '',
          email: s.email || '',
          schoolId: currentSchoolId,
          status: 'active',
          repairedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.warn('Could not write users doc for', uid, ':', e.message);
      }

      // Write /userSchools/{uid}
      try {
        await db.collection('userSchools').doc(uid).set({
          schoolIds: firebase.firestore.FieldValue.arrayUnion(currentSchoolId),
          roles: { [currentSchoolId]: normalizedRole },
          ownerEmails: { [currentSchoolId]: ownerEmail },
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        console.warn('Could not write userSchools doc for', uid, ':', e.message);
      }

      fixed++;
    }

    addNotification(`Repair complete: ${fixed} staff fixed, ${skipped} skipped (no UID).`, 'success');
    alert(`✅ Done! ${fixed} staff member(s) repaired. They can now log in.\n${skipped > 0 ? skipped + ' skipped (no Firebase UID — re-add them).' : ''}`);

  } catch (error) {
    console.error('Repair error:', error);
    alert('Repair failed: ' + error.message);
  }

  btn.textContent = '🔧 Fix Login Access';
  btn.disabled = false;
}

// Render staff table
function renderStaffTable() {
  const tb = document.getElementById('staff-table');
  if (!tb) return;
  
  // Check if school is selected
  if (!currentSchoolId) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">Please select a school to view staff members</td></tr>';
    return;
  }
  
  // Check if user has permission to view staff
  if (!hasPageAccess('staff-management')) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">You do not have permission to view this page</td></tr>';
    return;
  }
  
  if (!data.staff || data.staff.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text2);">No staff members added yet</td></tr>';
    return;
  }
  
  tb.innerHTML = data.staff.map(s => `
    <tr>
      <td><strong>${s.name || 'No name'}</strong></td>
      <td>${s.email || 'No email'}</td>
      <td>${s.phone || 'No phone'}</td>
      <td><span class="badge ${getRoleBadgeClass(s.role)}">${getRoleLabel(s.role)}</span></td>
      <td><span class="badge badge-gray">${getDepartmentLabel(s.department)}</span></td>
      <td><span class="badge ${s.status === 'active' ? 'badge-green' : 'badge-red'}">${s.status || 'Unknown'}</span></td>
      <td style="color:var(--text2);font-size:12px;">${s.joinedOn || s.createdAt || 'Unknown'}</td>
      <td>
        <div style="display:flex;gap:5px;">
          <button class="btn btn-outline btn-sm" onclick="editStaff('${s.id || 'unknown'}')" data-action="edit_staff">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="removeStaff('${s.id || 'unknown'}')" data-action="delete_staff">Remove</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Get role badge class
function getRoleBadgeClass(role) {
  switch(role) {
    case 'instructor': return 'badge-green';
    case 'office': return 'badge-blue';
    case 'admin': return 'badge-purple';
    case 'support': return 'badge-gray';
    case 'maintenance': return 'badge-amber';
    default: return 'badge-gray';
  }
}

// Get role label
function getRoleLabel(role) {
  switch(role) {
    case 'instructor': return 'Instructor';
    case 'office': return 'Office Staff';
    case 'admin': return 'Administrator';
    case 'support': return 'Support Staff';
    case 'maintenance': return 'Maintenance';
    default: return 'Unknown';
  }
}

// Get department label
function getDepartmentLabel(department) {
  switch(department) {
    case 'training': return 'Training';
    case 'administration': return 'Administration';
    case 'operations': return 'Operations';
    case 'support': return 'Support';
    case 'maintenance': return 'Maintenance';
    default: return 'Unknown';
  }
}

// Add staff from modal
async function addStaffFromModal() {
  // Check if user has permission to add staff
  if (!hasActionPermission('add_staff')) {
    alert('You do not have permission to add staff members.');
    return;
  }
  
  let secondaryAuthForStaff = null;
  let secondaryAppForIndex = null;

  try {
    const schoolId = document.getElementById('staff-school').value;
    const name = document.getElementById('staff-name').value.trim();
    const email = document.getElementById('staff-email').value.trim();
    const phone = document.getElementById('staff-phone').value.trim();
    const role = document.getElementById('staff-role').value;
    const department = document.getElementById('staff-department').value;
    const employeeId = document.getElementById('staff-employee-id').value.trim();
    const joiningDate = document.getElementById('staff-joining-date').value;
    const address = document.getElementById('staff-address').value.trim();
    const salary = document.getElementById('staff-salary').value;
    const workType = document.getElementById('staff-work-type').value;
    const notes = document.getElementById('staff-notes').value.trim();
    const password = document.getElementById('staff-password').value;
    const confirmPassword = document.getElementById('staff-confirm-password').value;
    
    // Validation
    if (!schoolId) {
      alert('Please select a school');
      return;
    }
    if (!name) {
      alert('Please enter staff name');
      return;
    }
    if (!email) {
      alert('Please enter email address');
      return;
    }
    if (!validateEmail(email)) {
      alert('Please enter a valid email address');
      return;
    }
    if (!phone) {
      alert('Please enter phone number');
      return;
    }
    if (!password) {
      alert('Please enter a password');
      return;
    }
    if (password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    
    // Create Firebase Auth user using secondary app to avoid signing out current user
    let staffUid = null;
    try {
      const secondaryApp =
        firebase.apps.find(a => a.name === 'secondary') ||
        firebase.initializeApp(firebase.app().options, 'secondary');
      secondaryAppForIndex = secondaryApp;
      secondaryAuthForStaff = secondaryApp.auth();
      const cred = await secondaryAuthForStaff.createUserWithEmailAndPassword(email, password);
      staffUid = cred.user.uid;
      console.log('Staff Firebase Auth account created, UID:', staffUid);
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        alert('This email already has a Firebase account. Please use a different email or contact the administrator.');
        return;
      } else {
        throw authErr;
      }
    }

    // Create staff object with Firebase UID
    const staffData = {
      userId: staffUid,
      firebaseId: staffUid,
      name,
      email,
      phone,
      role,
      department,
      employeeId,
      joiningDate,
      address,
      salary: salary ? parseFloat(salary) : 0,
      workType,
      notes,
      status: 'active',
      schoolId,
      ...FirebaseService.getOwnerScope(schoolId),
      createdAt: new Date().toISOString(),
      joinedOn: new Date().toLocaleDateString()
    };
    
    // Save to Firebase staff subcollection — use UID as doc ID
    const staffRef = db.collection('schools').doc(schoolId).collection('staff');
    await staffRef.doc(staffUid).set(staffData);

    const normalizedRole = role === 'instructor' ? 'instructor' : 'office';

    // Write membership doc to schools/{id}/users so isSchoolMember() rule passes for this user.
    // Requires Firestore rule: allow write: if isSchoolMember(schoolId) on /users/{userId}
    try {
      await db.collection('schools').doc(schoolId).collection('users').doc(staffUid).set({
        userId: staffUid,
        role: normalizedRole,
        userRole: normalizedRole,
        name,
        email,
        phone,
        schoolId,
        ...FirebaseService.getOwnerScope(schoolId),
        status: 'active',
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (usersErr) {
      console.warn('Could not write users membership doc (check Firestore rules):', usersErr.message);
      // Non-fatal: staff is saved; owner can re-add via Admin Management to fix membership
    }

    // Update local data
    if (!data.staff) data.staff = [];
    data.staff.push({...staffData, id: staffUid});

    // Write userSchools top-level index so the new staff member can log in
    let ownerEmail = null;
    try {
      const schoolDoc = await db.collection('schools').doc(schoolId).get();
      if (schoolDoc.exists) ownerEmail = schoolDoc.data().ownerEmail;
    } catch (e) {
      console.warn('Could not fetch school for ownerEmail:', e.message);
    }
    try {
      await writeUserSchoolsIndexAsCreatedUser(
        secondaryAppForIndex,
        staffUid,
        schoolId,
        normalizedRole,
        ownerEmail
      );
    } catch (idxErr) {
      console.warn('Could not write userSchools index (check Firestore rules):', idxErr.message);
    }
    
    // Clear form
    document.getElementById('staff-school').value = '';
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-phone').value = '';
    document.getElementById('staff-password').value = '';
    document.getElementById('staff-confirm-password').value = '';
    document.getElementById('staff-role').value = 'instructor';
    document.getElementById('staff-department').value = 'training';
    document.getElementById('staff-employee-id').value = '';
    document.getElementById('staff-joining-date').value = '';
    document.getElementById('staff-address').value = '';
    document.getElementById('staff-salary').value = '';
    document.getElementById('staff-work-type').value = 'full-time';
    document.getElementById('staff-notes').value = '';
    
    closeModal('modal-add-staff');
    renderStaffTable();
    addNotification(`Staff member "${name}" has been added successfully`, 'success');
    
  } catch (error) {
    console.error('Error adding staff:', error);
    alert('Error adding staff member. Please try again.');
  } finally {
    if (secondaryAuthForStaff) {
      try { await secondaryAuthForStaff.signOut(); } catch (e) { console.warn('Secondary staff sign-out failed:', e.message); }
    }
  }
}

// Edit staff
async function editStaff(staffId) {
  // Check if user has permission to edit staff
  if (!hasActionPermission('edit_staff')) {
    alert('You do not have permission to edit staff members.');
    return;
  }
  
  try {
    if (!currentSchoolId) {
      alert('Please select a school first');
      return;
    }
    
    const staffRef = db.collection('schools').doc(currentSchoolId).collection('staff').doc(staffId);
    const staffDoc = await staffRef.get();
    
    if (!staffDoc.exists) {
      alert('Staff member not found');
      return;
    }
    
    const staff = staffDoc.data();
    
    // Populate form with staff data
    document.getElementById('staff-school').value = currentSchoolId;
    document.getElementById('staff-name').value = staff.name || '';
    document.getElementById('staff-email').value = staff.email || '';
    document.getElementById('staff-phone').value = staff.phone || '';
    document.getElementById('staff-role').value = staff.role || 'instructor';
    document.getElementById('staff-department').value = staff.department || 'training';
    document.getElementById('staff-employee-id').value = staff.employeeId || '';
    document.getElementById('staff-joining-date').value = staff.joiningDate || '';
    document.getElementById('staff-address').value = staff.address || '';
    document.getElementById('staff-salary').value = staff.salary || '';
    document.getElementById('staff-work-type').value = staff.workType || 'full-time';
    document.getElementById('staff-notes').value = staff.notes || '';
    
    // Change button text and onclick
    const addBtn = document.querySelector('button[onclick="addStaffFromModal()"]');
    if (addBtn) {
      addBtn.textContent = 'Update Staff';
      addBtn.onclick = () => updateStaff(staffId);
    }
    
    openModal('modal-add-staff');
    
  } catch (error) {
    console.error('Error editing staff:', error);
    alert('Error loading staff member data. Please try again.');
  }
}

// Update staff
async function updateStaff(staffId) {
  try {
    const name = document.getElementById('staff-name').value.trim();
    const email = document.getElementById('staff-email').value.trim();
    const phone = document.getElementById('staff-phone').value.trim();
    const role = document.getElementById('staff-role').value;
    const department = document.getElementById('staff-department').value;
    const employeeId = document.getElementById('staff-employee-id').value.trim();
    const joiningDate = document.getElementById('staff-joining-date').value;
    const address = document.getElementById('staff-address').value.trim();
    const salary = document.getElementById('staff-salary').value;
    const workType = document.getElementById('staff-work-type').value;
    const notes = document.getElementById('staff-notes').value.trim();
    
    // Validation
    if (!name) {
      alert('Please enter staff name');
      return;
    }
    if (!email) {
      alert('Please enter email address');
      return;
    }
    if (!validateEmail(email)) {
      alert('Please enter a valid email address');
      return;
    }
    if (!phone) {
      alert('Please enter phone number');
      return;
    }
    
    // Update staff object
    const updateData = {
      name,
      email,
      phone,
      role,
      department,
      employeeId,
      joiningDate,
      address,
      salary: salary ? parseFloat(salary) : 0,
      workType,
      notes,
      updatedAt: new Date().toISOString()
    };
    
    // Update in Firebase — use set+merge so it works even if the doc was briefly absent
    await db.collection('schools').doc(currentSchoolId).collection('staff').doc(staffId).set(updateData, { merge: true });
    
    // Keep the users subcollection in sync (role may have changed)
    const normalizedRole = role === 'instructor' ? 'instructor' : 'office';
    try {
      await db.collection('schools').doc(currentSchoolId).collection('users').doc(staffId).set({
        role: normalizedRole,
        userRole: normalizedRole,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      // Also update the userSchools index role
      await db.collection('userSchools').doc(staffId).set({
        roles: { [currentSchoolId]: normalizedRole },
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (syncErr) {
      console.warn('Role sync to users/userSchools failed (non-fatal):', syncErr.message);
    }
    
    // Update local data
    const staffIndex = data.staff.findIndex(s => s.id === staffId);
    if (staffIndex !== -1) {
      data.staff[staffIndex] = {...data.staff[staffIndex], ...updateData};
    }
    
    // Reset button
    const addBtn = document.querySelector('button[onclick*="updateStaff"]');
    if (addBtn) {
      addBtn.textContent = 'Add Staff';
      addBtn.onclick = addStaffFromModal;
    }
    
    // Clear form
    document.getElementById('staff-school').value = '';
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-phone').value = '';
    document.getElementById('staff-role').value = 'instructor';
    document.getElementById('staff-department').value = 'training';
    document.getElementById('staff-employee-id').value = '';
    document.getElementById('staff-joining-date').value = '';
    document.getElementById('staff-address').value = '';
    document.getElementById('staff-salary').value = '';
    document.getElementById('staff-work-type').value = 'full-time';
    document.getElementById('staff-notes').value = '';
    
    closeModal('modal-add-staff');
    renderStaffTable();
    addNotification(`Staff member "${name}" has been updated successfully`, 'success');
    
  } catch (error) {
    console.error('Error updating staff:', error);
    alert('Error updating staff member. Please try again.');
  }
}

// Remove staff
async function removeStaff(staffId) {
  if (!confirm('Are you sure you want to remove this staff member?')) {
    return;
  }
  
  try {
    if (!currentSchoolId) {
      console.log('Cannot remove from Firebase - no school selected');
      return;
    }
    
    const staffRef = db.collection('schools').doc(currentSchoolId).collection('staff').doc(staffId);
    const staffDoc = await staffRef.get();
    
    if (!staffDoc.exists) {
      alert('Staff member not found');
      return;
    }
    
    const staff = staffDoc.data();
    
    // Remove from Firebase
    await staffRef.delete();
    
    // Update local data
    data.staff = data.staff.filter(s => s.id !== staffId);
    
    renderStaffTable();
    addNotification(`Staff member "${staff.name}" has been removed`, 'info');
    
  } catch (error) {
    console.error('Error removing staff:', error);
    alert('Error removing staff member. Please try again.');
  }
}

// Open staff modal with school dropdown populated
function openStaffModal() {
  populateStaffSchoolDropdown();
  openModal('modal-add-staff');
}

// Populate staff school dropdown
async function populateStaffSchoolDropdown() {
  const select = document.getElementById('staff-school');
  if (!select) return;
  
  select.innerHTML = '<option value="">Choose a school...</option>';
  
  try {
    if (currentRole === 'owner') {
      // Owner can add staff to any school they own
      const schools = await FirebaseService.getUserSchools(auth.currentUser.uid);
      schools.forEach(school => {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.name;
        select.appendChild(option);
      });
      // If current school is selected, set it as default
      if (currentSchoolId) {
        select.value = currentSchoolId;
      }
    } else {
      // Office staff can only add staff to their current school
      if (currentSchoolId) {
        const option = document.createElement('option');
        option.value = currentSchoolId;
        option.textContent = data.school?.name || 'Current School';
        select.appendChild(option);
        select.value = currentSchoolId;
      }
    }
  } catch (error) {
    console.error('Error populating school dropdown:', error);
  }
}


// ============================================================
