#!/bin/bash

# Configuration
PATH_TO_UPLOADS=/opt/shooting-stars-meme-generator/public/uploads
DAYS_BEFORE_REMOVAL=30

# Delete files uploaded since more than X days (configuration)
find $PATH_TO_UPLOADS -ctime +$DAYS_BEFORE_REMOVAL -delete