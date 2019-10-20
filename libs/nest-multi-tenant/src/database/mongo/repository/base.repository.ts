import { Collection, ObjectID, DeleteWriteOpResultObject } from 'mongodb';
import {
  COLLECTION_KEY, CollectionProps, DBSource, FindRequest,
  POST_KEY, PRE_KEY, UpdateByIdRequest, UpdateRequest,
} from '../interfaces';

// that class only can be extended
export class BaseRepository <DOC, DTO = DOC> {
  collection: Promise<Collection<DOC>>;
  readonly options: CollectionProps;

  // get options(): CollectionProps {
  //   return Reflect.getMetadata(COLLECTION_KEY, this);
  // }

  /**
   * Creates an instance of BaseRepository.
   * @param {DBSource} dbSource Your MongoDB connection
   * @memberof BaseRepository
   */
  constructor(public dbSource: DBSource, opts?: CollectionProps) {
    this.options = Object.assign({}, opts, Reflect.getMetadata(COLLECTION_KEY, this));
    if (!this.options.name) {
      throw new Error('No name was provided for this collection');
    }
    this.collection = this.getCollection();
  }

  /**
   * Finds a record by id
   *
   * @param {string} id
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  findById(id: string): Promise<DOC> {
    return this.findOne({ _id: new ObjectID(id) });
  }

  /**
   * Find multiple documents by a list of ids
   *
   * @param {string[]} ids
   * @returns {Promise<T[]>}
   * @memberof BaseRepository
   */
  async findManyById(ids: string[]): Promise<DOC[]> {
    const collection = await this.collection;
    const query = { _id: { $in: ids.map(id => new ObjectID(id)) } };
    const found = await collection.find(query as object).toArray();

    const results: DOC[] = [];
    for (const result of found) {
      results.push(await this.invokeEvents(POST_KEY, ['find', 'findMany'], this.toggleId(result, false)));
    }

    return results;
  }

  /**
   * Finds a record by a list of conditions
   *
   * @param {object} conditions
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  async findOne(conditions: object): Promise<DOC> {
    const collection = await this.collection;

    let document = await collection.findOne(conditions);
    if (document) {
      document = this.toggleId(document, false);
      document = await this.invokeEvents(POST_KEY, ['find', 'findOne'], document);
      return document;
    }
  }

  /**
   * Find records by a list of conditions
   *
   * @param {FindRequest} [req={ conditions: {} }]
   * @returns {Promise<T[]>}
   * @memberof BaseRepository
   */
  async find(req: FindRequest = { conditions: {} }): Promise<DOC[]> {
    const collection = await this.collection;

    const conditions = this.toggleId(req.conditions, true);
    let cursor = collection.find(conditions);

    if (req.projection) {
      cursor = cursor.project(req.projection);
    }

    if (req.sort) {
      cursor = cursor.sort(req.sort);
    }

    if (req.skip) {
      cursor = cursor.skip(req.skip);
    }

    if (req.limit) {
      cursor = cursor.limit(req.limit);
    }

    const newDocuments = await cursor.toArray();
    const results = [];

    for (let document of newDocuments) {
      document = this.toggleId(document, false);
      document = await this.invokeEvents(POST_KEY, ['find', 'findMany'], document);
      results.push(document);
    }

    return results;
  }

  /**
   * Create a document of type T
   *
   * @param {DTO} document
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  async create(document: DTO): Promise<DOC> {
    const collection = await this.collection;
    const eventResult: unknown = await this.invokeEvents(PRE_KEY, ['save', 'create'], document);
    const res = await collection.insertOne(eventResult as DOC);

    let newDocument = res.ops[0];
    // @ts-ignore
    newDocument = this.toggleId(newDocument, false);
    newDocument = await this.invokeEvents(POST_KEY, ['save', 'create'], newDocument);
    // @ts-ignore
    return newDocument;
  }

  /**
   * Save any changes to your document
   *
   * @param {Document} document
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  async save(document: Document): Promise<DOC> {
    const collection = await this.collection;

    // @ts-ignore
    const id = new ObjectID(document.id);  // flip/flop ids

    const updates = await this.invokeEvents(PRE_KEY, ['save'], document);
    delete updates.id;
    delete updates._id;
    const query = { _id: id };
    const res = await collection.updateOne(query as object, { $set: updates }, { upsert: true });
    let newDocument = await collection.findOne(query as object);

    // project new items
    if (newDocument) {
      Object.assign(document, newDocument);
    }

    // @ts-ignore
    newDocument.id = id.toString(); // flip flop ids back
    // @ts-ignore
    delete newDocument._id;

    newDocument = await this.invokeEvents(POST_KEY, ['save'], newDocument);
    return newDocument;
  }

  /**
   * Find a record by ID and update with new values
   *
   * @param {string} id
   * @param {UpdateByIdRequest} req
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  async findOneByIdAndUpdate(id: string, req: UpdateByIdRequest): Promise<DOC> {
    return this.findOneAndUpdate({
      conditions: { _id: new ObjectID(id) },
      updates: req.updates,
      upsert: req.upsert,
    });
  }

  /**
   * Find a record and update with new values
   *
   * @param {UpdateRequest} req
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  async findOneAndUpdate(req: UpdateRequest): Promise<DOC> {
    const collection = await this.collection;
    const updates = await this.invokeEvents(PRE_KEY, ['update', 'updateOne'], req.updates);

    const res = await collection.findOneAndUpdate(req.conditions, updates, {
      upsert: req.upsert,
      returnOriginal: false,
    });

    let document = res.value;
    document = this.toggleId(document, false);
    document = await this.invokeEvents(POST_KEY, ['update', 'updateOne'], document);
    return document;
  }

  /**
   * Delete a record by ID
   *
   * @param {string} id
   * @returns {Promise<DeleteWriteOpResultObject>}
   * @memberof BaseRepository
   */
  async deleteOneById(id: string): Promise<DeleteWriteOpResultObject> {
    return this.deleteOne({ _id: new ObjectID(id) });
  }

  /**
   * Delete a record
   *
   * @param {*} conditions
   * @returns {Promise<DeleteWriteOpResultObject>}
   * @memberof BaseRepository
   */
  async deleteOne(conditions: any): Promise<DeleteWriteOpResultObject> {
    const collection = await this.collection;

    await this.invokeEvents(PRE_KEY, ['delete', 'deleteOne'], conditions);
    const deleteResult = collection.deleteOne(conditions);
    await this.invokeEvents(POST_KEY, ['delete', 'deleteOne'], deleteResult);

    return deleteResult;
  }

  /**
   * Delete multiple records
   *
   * @param {*} conditions
   * @returns {Promise<any>}
   * @memberof BaseRepository
   */
  async deleteMany(conditions: any): Promise<DeleteWriteOpResultObject> {
    const collection = await this.collection;

    await this.invokeEvents(PRE_KEY, ['delete', 'deleteMany'], conditions);
    const deleteResult = collection.deleteMany(conditions);
    await this.invokeEvents(POST_KEY, ['delete', 'deleteMany'], deleteResult);

    return deleteResult;
  }

  /**
   * Strip off Mongo's ObjectID and replace with string representation or in reverse
   *
   * @private
   * @param {*} document
   * @param {boolean} replace
   * @returns {T}
   * @memberof BaseRepository
   */
  protected toggleId(document: any, replace: boolean): DOC {
    if (document && (document.id || document._id)) {
      if (replace) {
        document._id = new ObjectID(document.id);
        delete document.id;
      } else {
        document.id = document._id.toString();
        delete document._id;
      }
    }
    return document;
  }

  /**
   * Return a collection
   * If the collection doesn't exist, it will create it with the given options
   *
   * @private
   * @returns {Promise<Collection<DOC>>}
   * @memberof BaseRepository
   */
  private getCollection(): Promise<Collection<DOC>> {
    return new Promise<Collection<DOC>>(async (resolve, reject) => {
      const db = await this.dbSource.db;
      db.collection(this.options.name, { strict: true }, async (err, collection) => {
        let ourCollection = collection;
        if (err) {
          try {
            ourCollection = await db.createCollection(this.options.name, {
              size: this.options.size,
              capped: this.options.capped,
              max: this.options.max,
            });
          } catch (createErr) {
            reject(createErr);
          }
        }

        // assert indexes
        if (this.options.indexes) {
          for (const indexDefinition of this.options.indexes) {
            try {
              await ourCollection.createIndex(indexDefinition.fields, indexDefinition.options);
            } catch (indexErr) {
              if (
                indexDefinition.overwrite &&
                indexDefinition.options.name &&
                indexErr.name === 'MongoError' &&
                (indexErr.codeName === 'IndexKeySpecsConflict' || indexErr.codeName === 'IndexOptionsConflict')
              ) {
                // drop index and recreate
                try {
                  await ourCollection.dropIndex(indexDefinition.options.name);
                  await ourCollection.createIndex(indexDefinition.fields, indexDefinition.options);
                } catch (recreateErr) {
                  reject(recreateErr);
                }
              } else {
                reject(indexErr);
              }
            }
          }
        }

        resolve(ourCollection);
      });
    });
  }

  /**
   * Apply functions to a record based on the type of event
   *
   * @private
   * @param {string} type any of the valid types, PRE_KEY POST_KEY
   * @param {string[]} fns any of the valid functions: update, updateOne, save, create, find, findOne, findMany
   * @param {*} document The document to apply functions to
   * @returns {Promise<DOC>}
   * @memberof BaseRepository
   */
  private async invokeEvents(type: string, fns: string[], document: any): Promise<any> {
    for (const fn of fns) {
      const events = Reflect.getMetadata(`${type}_${fn}`, this) || [];
      for (const event of events) {
        document = event.bind(this)(document);
        if (typeof document.then === 'function') {
          document = await document;
        }
      }
    }

    return document;
  }
}