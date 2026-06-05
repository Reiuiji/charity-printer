#!/bin/bash
set -e

echo "======================================================"
echo " Web Receipt Printer - Linux USB Permission Setup"
echo "======================================================"
echo "This script will create a udev rule to allow Chrome/Edge"
echo "to access your USB thermal receipt printer via WebUSB."
echo ""

RULE_FILE="/etc/udev/rules.d/99-web-receipt-printer.rules"

echo "Choose an option:"
echo "1) Grant access to ALL USB devices of class 'Printer' (Recommended for most thermal printers)"
echo "2) Grant access to a specific printer using Vendor ID and Product ID"
read -p "Enter choice [1-2]: " choice

if [ "$choice" = "1" ]; then
    RULE='SUBSYSTEMS=="usb", ATTRS{bInterfaceClass}=="07", MODE="0666", TAG+="uaccess"'
    echo "Creating generic USB printer rule..."
elif [ "$choice" = "2" ]; then
    read -p "Enter Vendor ID (4-digit hex, e.g. 04b8): " vid
    read -p "Enter Product ID (4-digit hex, e.g. 0202): " pid
    
    # Normalize input
    vid=$(echo "$vid" | tr '[:upper:]' '[:lower:]' | sed 's/^0x//')
    pid=$(echo "$pid" | tr '[:upper:]' '[:lower:]' | sed 's/^0x//')
    
    RULE="SUBSYSTEM==\"usb\", ATTR{idVendor}==\"$vid\", ATTR{idProduct}==\"$pid\", MODE=\"0666\", TAG+=\"uaccess\""
    echo "Creating rule for USB device $vid:$pid..."
else
    echo "Invalid choice. Exiting."
    exit 1
fi

echo "Writing rule to $RULE_FILE..."
echo "$RULE" | sudo tee "$RULE_FILE" > /dev/null

echo "Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger

echo ""
echo "Done! Please unplug your printer, plug it back in, and try connecting again."
