# Restaurant POS System

A professional multi-terminal Point of Sale system for restaurants.

## Quick Start

### For Windows Users

1. **Install Node.js** (if not already installed)
   - Download from: https://nodejs.org/
   - Choose "LTS" (Long Term Support) version
   - Run installer with default settings
   - **Important:** Make sure "Add to PATH" is checked
   - Restart your computer after installation

2. **Launch the Application**
   - **Option A (Recommended):** Double-click `Restaurant POS.vbs`
     - This launches silently without showing a command window
     - Professional appearance
   
   - **Option B (Diagnostic):** Double-click `START_RESTAURANT_POS.bat`
     - Shows detailed startup messages
     - Use this if you need to troubleshoot

3. **First Launch**
   - Application will automatically install required files (takes 1-2 minutes)
   - You'll see the Configuration screen
   - Select "Admin" or "Cashier" mode
   - Login with your credentials
   - System is ready to use!

## System Requirements

- **Windows:** Windows 7 or later
- **Node.js:** Version 16 LTS or newer
- **Disk Space:** 500 MB (including node_modules)
- **RAM:** 2 GB minimum
- **Network:** Internet connection for first launch setup

## Features

✅ Multi-terminal support  
✅ Admin and Cashier modes  
✅ Real-time synchronization  
✅ Order management  
✅ Payment processing  
✅ Sales reports  
✅ User management  

## Troubleshooting

### "Node.js is not installed"
- Install Node.js from https://nodejs.org/
- Make sure to check "Add to PATH" during installation
- Restart your computer
- Try launching again

### Application won't start
1. Try `START_RESTAURANT_POS.bat` (to see error messages)
2. Ensure you have internet connection
3. Check that port 3000 is not in use
4. Try restarting your computer

### "npm is not available"
- Reinstall Node.js
- Make sure npm checkbox is selected during installation

### Slow first launch
- First launch installs all dependencies (normal, takes 1-2 minutes)
- Subsequent launches will be faster

### Port 3000 already in use
- The application uses port 3000
- Close any other applications using this port
- Or wait a few seconds and try launching again

### Resetting local and MySQL data
- Run `npm run cleanup:db` to see the safe cleanup instructions.
- To actually clear data, run `npm run cleanup:db -- --force`.
- Use `node scripts/cleanup-db.js hard --force` if you also want to remove local database artifacts in addition to MySQL records.

## Creating a Desktop Shortcut (Optional)

### For Silent Launch (Recommended):
1. Right-click `Restaurant POS.vbs`
2. Select "Send to" → "Desktop (create shortcut)"
3. Rename the shortcut to "Restaurant POS"
4. (Optional) Right-click shortcut → Properties → Change Icon

### For Diagnostic Launch:
1. Right-click `START_RESTAURANT_POS.bat`
2. Select "Send to" → "Desktop (create shortcut)"
3. Rename to "Restaurant POS Setup"

## Support

For technical issues:
1. Run `START_RESTAURANT_POS.bat` to see detailed error messages
2. Take a screenshot of any error messages
3. Check System Requirements above
4. Contact support with error details

## Files Included

- `Restaurant POS.vbs` - Silent launcher (recommended)
- `START_RESTAURANT_POS.bat` - Diagnostic launcher
- `package.json` - Application configuration
- `main.js` - Application entry point
- `server.js` - Backend server
- `assets/` - UI files and resources
- `README.md` - This file

## Notes

- Application data is stored locally
- First launch requires internet connection
- Port 3000 must be available
- Administrator privileges are not required

---

**Restaurant POS System v1.0.0**  
Ready for professional deployment
