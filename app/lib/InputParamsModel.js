class InputParamsModel {
  constructor({ packageName, projectID, bucketName }) {
    this.packageName = packageName;
    this.projectID = projectID;
    this.bucketName = bucketName;
  }
}

module.exports = InputParamsModel;
