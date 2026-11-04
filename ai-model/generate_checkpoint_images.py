"""
Generate realistic test images for the 4 GrainShield checkpoints:
  1. Checkpoint 1 (FCI Departure): FCI Godown backdrop, Truck, Plate GJ01AB1234
  2. Checkpoint 2 (GSCSCL Arrival e-POD): GSCSCL Godown backdrop, Truck, Plate GJ01AB1234
  3. Checkpoint 3 (GSCSCL Departure): GSCSCL Loading yard, Mini-truck, Plate GJ01CD5678
  4. Checkpoint 4 (FPS Delivery e-POD): FPS Shopfront, FPS Banner "FPS-AMD-001 ANNA BHARAT", Person, Plate GJ01CD5678
"""
import os
import cv2
import numpy as np

os.makedirs("test_fixtures", exist_ok=True)

def draw_plate(img, text, x, y, w, h):
    cv2.rectangle(img, (x, y), (x + w, y + h), (245, 245, 245), -1)
    cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 0), 2)
    # IND badge
    cv2.rectangle(img, (x, y), (x + int(w * 0.12), y + h), (200, 220, 240), -1)
    cv2.putText(img, "IND", (x + 2, y + int(h * 0.65)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (180, 50, 0), 1)
    # Plate number
    cv2.putText(img, text, (x + int(w * 0.16), y + int(h * 0.72)), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 0), 2)

# Checkpoint 1: FCI Departure
img1 = np.ones((480, 640, 3), dtype=np.uint8) * 160
cv2.rectangle(img1, (0, 300), (640, 480), (70, 70, 70), -1) # Road
cv2.rectangle(img1, (100, 120), (540, 420), (50, 60, 80), -1) # Truck body
cv2.rectangle(img1, (160, 260), (480, 380), (30, 30, 30), -1) # Bumper
draw_plate(img1, "GJ01AB1234", 230, 310, 180, 50)
cv2.imwrite("test_fixtures/cp1_fci_departure.jpg", img1)

# Checkpoint 2: GSCSCL Arrival
img2 = np.ones((480, 640, 3), dtype=np.uint8) * 150
cv2.rectangle(img2, (0, 320), (640, 480), (60, 60, 60), -1) # Tarmac
cv2.rectangle(img2, (120, 140), (520, 420), (40, 80, 40), -1) # Green grain truck
cv2.rectangle(img2, (180, 280), (460, 380), (25, 25, 25), -1)
draw_plate(img2, "GJ01AB1234", 230, 320, 180, 50)
cv2.imwrite("test_fixtures/cp2_gscscl_arrival.jpg", img2)

# Checkpoint 3: GSCSCL Departure
img3 = np.ones((480, 640, 3), dtype=np.uint8) * 140
cv2.rectangle(img3, (0, 310), (640, 480), (65, 65, 65), -1)
cv2.rectangle(img3, (140, 150), (500, 410), (90, 50, 40), -1) # Distribution mini-truck
cv2.rectangle(img3, (200, 290), (440, 380), (30, 30, 30), -1)
draw_plate(img3, "GJ01CD5678", 230, 320, 180, 50)
cv2.imwrite("test_fixtures/cp3_gscscl_departure.jpg", img3)

# Checkpoint 4: Fair Price Shop Delivery (Last Mile e-POD)
img4 = np.ones((480, 640, 3), dtype=np.uint8) * 170
# Shopfront background
cv2.rectangle(img4, (0, 0), (640, 240), (220, 210, 190), -1)
# FPS Banner on top
cv2.rectangle(img4, (60, 20), (580, 100), (255, 255, 255), -1)
cv2.rectangle(img4, (60, 20), (580, 100), (0, 0, 180), 3)
cv2.putText(img4, "GOVERNMENT OF GUJARAT PDS", (120, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 150), 2)
cv2.putText(img4, "FPS-AMD-001 PANDIT DINDAYAL GRAHAK BHANDAR", (80, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 120, 0), 2)
# Mini truck
cv2.rectangle(img4, (160, 180), (560, 440), (80, 80, 90), -1)
draw_plate(img4, "GJ01CD5678", 250, 350, 180, 50)
# Dealer / recipient person standing beside truck
cv2.circle(img4, (100, 240), 30, (210, 180, 150), -1) # Head
cv2.rectangle(img4, (70, 270), (130, 440), (30, 80, 160), -1) # Torso / clothing
cv2.imwrite("test_fixtures/cp4_fps_delivery.jpg", img4)

print("Generated 4 realistic checkpoint images in test_fixtures/")
