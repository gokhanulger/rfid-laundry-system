# RFID Laundry Tracking System

A comprehensive laundry management system for industrial laundries that service hotels. Tracks every textile item (towels, linens, etc.) using RFID technology from the moment it leaves the hotel dirty until it returns clean.

## 🏗️ Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Authentication**: Email/Password with session management
- **Multi-tenant**: Each hotel is isolated, laundry serves all hotels

## 👥 User Roles

- **Hotel Owner** - Monitors their items, receives reports
- **Laundry Manager** - Oversees the entire laundry operation
- **Operator** - Laundry staff doing day-to-day operations
- **Driver** - Picks up dirty items from hotels, delivers clean items back
- **Packager** - Packages clean items for delivery
- **System Admin** - Manages all tenants and users

## 🔄 Complete 8-Step Workflow

### Step 1: Dirty Pickup from Hotel
**Page**: "Kirli Teslim Toplama" (Dirty Pickup)  
**Who**: Driver  
**What**: Driver goes to hotel, creates pickup record with bag code and seal number  
**Result**: Pickup receipt generated and emailed to hotel

### Step 2: Deliver Dirty Items to Laundry
**Page**: "Kirli Teslim Alma" (Receive Dirty)  
**Who**: Driver or Laundry Staff  
**What**: Mark pickup as received at laundry facility  
**Result**: System automatically marks hotel items as "dirty" (status: at_laundry)

### Step 3: Scan & Process Dirty Items
**Page**: "Çamaşır İşleme" (Laundry Processing)  
**Who**: Laundry Operator  
**What**: Two options:
- Scan RFID tags of dirty items
- Use dropdown to select and mark items as clean
**Result**: Items tracked as being processed

### Step 4: Washing
Items go through wash cycles  
Wash count automatically incremented

### Step 5: Mark Items Clean
**Page**: "Ütü Etiketi" (Ironer Interface) OR "Çamaşır İşleme"  
**Who**: Ironer/Operator  
**What**: Scan or select items to mark as clean  
**Result**: Items marked as ready_for_delivery

### Step 6: Print Delivery Labels
**Page**: "Etiket Yazdırma" (Label Printing)  
**Who**: Ironer  
**What**: Print PDF labels with barcodes for deliveries  
**Result**: Delivery packages labeled, status: label_printed

### Step 7: Package Items
**Page**: "Paketleme" (Packaging)  
**Who**: Packager  
**What**: Scan delivery labels, confirm packaging  
**Result**: Status: packaged, ready for pickup

### Step 8: Deliver Clean Items to Hotel
**Page**: "Sürücü Aktiviteleri" (Driver Scan)  
**Who**: Driver  
**What**: 
- Pick up packaged deliveries from laundry
- Deliver to hotel and scan confirmation
**Result**: Items returned to hotel, wash count incremented, email sent to hotel owner

## 📋 Key Features & Pages

### Operations Pages
- 📊 **Dashboard** - Overview of all operations, statistics
- 📷 **Toplu Tarama** (Bulk Scan) - Rapid RFID scanning interface
- 📦 **Kirli Teslim Toplama** (Dirty Pickup) - Create pickups from hotels
- 🏭 **Kirli Teslim Alma** (Receive Dirty) - Receive dirty items at laundry
- ✨ **Çamaşır İşleme** (Laundry Processing) - Process and mark items clean
- 📥 **Gelen Takip** (Inbound) - Track items coming in
- 📤 **Giden Takip** (Outbound) - Track items going out
- 🔄 **Rewash Queue** - Items needing special processing

### Management Pages
- 🚨 **Uyarılar** (Alerts) - System alerts and notifications
- 📈 **Raporlar** (Reports) - Lifecycle reports, wash cycles
- ⚙️ **Ayarlar** (Settings) - Configure tenants, locations, item types

### Admin Pages
- 🚛 **Teslimat Yönetimi** (Delivery Management) - Full delivery lifecycle
- 🛡️ **Sürücü Aktiviteleri** (Driver Activities) - Monitor driver actions
- 🖨️ **Ütü Etiketi** (Ironer Interface) - Mark items clean and print labels
- 📦 **Paketleme** (Packaging) - Package clean items

## ✨ Special Features

- **RFID Tracking** - Every item has a unique RFID tag
- **Multi-tenant** - One laundry serves multiple hotels, data is isolated
- **Wash Count Tracking** - Track how many times each item is washed
- **Exception Handling** - Track stained/damaged items
- **Automated Alerts** - Missing items, dwell time warnings
- **Audit Trail** - Everything is logged for compliance
- **Email Notifications** - Automatic receipts and confirmations
- **Barcode System** - Print and scan delivery labels

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (or Neon account)
- npm or yarn

### Installation

```bash
# Install dependencies
cd frontend && npm install
cd ../backend && npm install

# Set up environment variables
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials

# Run database migrations
cd backend && npm run db:migrate

# Start development servers
cd frontend && npm run dev
cd backend && npm run dev
```

## 📁 Project Structure

```
RFID/
├── frontend/          # React + TypeScript frontend
├── backend/           # Express.js + TypeScript backend
├── shared/            # Shared types and utilities
└── README.md          # This file
```

## 🔐 Environment Variables

See `backend/.env.example` for required environment variables.

## 📝 License

Proprietary - All rights reserved

