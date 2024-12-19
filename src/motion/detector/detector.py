import os
from flask import Flask, request
import torch

model = torch.hub.load('ultralytics/yolov5', 'yolov5s')

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "./" #"/var/lib/homebridge" # swap to ./ for testing locally

@app.route("/", methods=["POST"])
def upload_file():
    if "imageFile" not in request.files:
        return "there is no imageFile field with a valid image file in the form!"
    imageFile = request.files["imageFile"]
    path = os.path.join(app.config["UPLOAD_FOLDER"], imageFile.filename)
    imageFile.save(path)
    return process_image(path)

def process_image(imgPath):
    results = model(imgPath)
    if os.path.exists(imgPath):
        os.remove(imgPath)
    return results.pandas().xyxy[0].to_json()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050)

# Resources:
# - https://www.section.io/engineering-education/object-detection-with-yolov5-and-pytorch/
# - https://thewebdev.info/2022/05/22/how-to-upload-image-in-flask-and-python/
