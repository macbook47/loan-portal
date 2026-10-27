# Red Hat UBI Python image: non-root, works with OpenShift's random UID
FROM registry.access.redhat.com/ubi9/python-311:latest
COPY app.py /opt/app-root/src/app.py
ENV PORT=9000 STARTUP_DELAY_SEC=5 PYTHONUNBUFFERED=1
EXPOSE 9000
CMD ["python", "/opt/app-root/src/app.py"]
